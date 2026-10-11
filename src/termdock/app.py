from __future__ import annotations

import asyncio
import hmac
import os
import sys
from collections.abc import AsyncIterator
from importlib.resources import files

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

from .auth import decode_basic, verify_password
from .config import Config
from .tabs import TabStore

HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "authorization", "cookie",
}
CONFIG_KEY = web.AppKey("config", Config)
TABS_KEY = web.AppKey("tabs", TabStore)
CLIENT_KEY = web.AppKey("client", ClientSession)


def security_headers(response: web.StreamResponse) -> None:
    response.headers.update({
        "Content-Security-Policy": "default-src 'self'; frame-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cache-Control": "no-store",
    })


@web.middleware
async def secure_middleware(request: web.Request, handler):
    if request.path != "/healthz":
        config = request.app[CONFIG_KEY]
        credentials = decode_basic(request.headers.get("Authorization", ""))
        valid = False
        if credentials:
            username, password = credentials
            valid = hmac.compare_digest(username, config.web_username) and verify_password(password, config.web_password_hash)
        if not valid:
            response = web.Response(status=401, text="Authentication required.\n")
            response.headers["WWW-Authenticate"] = 'Basic realm="TermDock", charset="UTF-8"'
            security_headers(response)
            return response
    try:
        response = await handler(request)
    except web.HTTPException as exc:
        security_headers(exc)
        raise
    security_headers(response)
    return response


def require_mutation_header(request: web.Request) -> None:
    if request.headers.get("X-TermDock-Request") != "1":
        raise web.HTTPForbidden(text="Missing same-origin request marker.\n")


async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "service": "termdock"})


async def index(request: web.Request) -> web.Response:
    path = files("termdock").joinpath("static/index.html")
    return web.Response(body=path.read_bytes(), content_type="text/html", charset="utf-8")


async def asset(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if name not in {"app.js", "style.css", "mobile.css"}:
        raise web.HTTPNotFound()
    path = files("termdock").joinpath(f"static/{name}")
    content_type = "application/javascript" if name.endswith(".js") else "text/css"
    return web.Response(body=path.read_bytes(), content_type=content_type, charset="utf-8")


async def list_tabs(request: web.Request) -> web.Response:
    store = request.app[TABS_KEY]
    return web.json_response({"tabs": await store.list()})


async def create_tab(request: web.Request) -> web.Response:
    require_mutation_header(request)
    store = request.app[TABS_KEY]
    return web.json_response(await store.create(), status=201)


async def delete_tab(request: web.Request) -> web.Response:
    require_mutation_header(request)
    store = request.app[TABS_KEY]
    try:
        await store.delete(request.match_info["tab_id"])
    except ValueError as exc:
        raise web.HTTPBadRequest(text=f"{exc}\n") from exc
    except RuntimeError as exc:
        raise web.HTTPInternalServerError(text=f"{exc}\n") from exc
    return web.json_response({"ok": True})


def upstream_url(request: web.Request) -> str:
    config = request.app[CONFIG_KEY]
    suffix = request.rel_url.path_qs
    return f"http://127.0.0.1:{config.ttyd_port}{suffix}"


async def pump_websocket(source, target) -> None:
    async for message in source:
        if message.type == WSMsgType.TEXT:
            await target.send_str(message.data)
        elif message.type == WSMsgType.BINARY:
            await target.send_bytes(message.data)
        elif message.type == WSMsgType.PING:
            await target.ping(message.data)
        elif message.type == WSMsgType.PONG:
            await target.pong(message.data)
        elif message.type in {WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR}:
            break


async def proxy_websocket(request: web.Request) -> web.StreamResponse:
    session = request.app[CLIENT_KEY]
    protocols = tuple(value.strip() for value in request.headers.get("Sec-WebSocket-Protocol", "").split(",") if value.strip())
    try:
        upstream = await session.ws_connect(upstream_url(request), protocols=protocols, max_msg_size=0)
    except Exception as exc:
        raise web.HTTPBadGateway(text="Terminal backend is unavailable.\n") from exc
    downstream = web.WebSocketResponse(protocols=protocols, max_msg_size=0)
    await downstream.prepare(request)
    tasks = {asyncio.create_task(pump_websocket(downstream, upstream)), asyncio.create_task(pump_websocket(upstream, downstream))}
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    await asyncio.gather(*done, *pending, return_exceptions=True)
    await upstream.close()
    await downstream.close()
    return downstream


async def proxy_http(request: web.Request) -> web.StreamResponse:
    session = request.app[CLIENT_KEY]
    headers = {key: value for key, value in request.headers.items() if key.lower() not in HOP_HEADERS and key.lower() != "host"}
    try:
        upstream = await session.request(request.method, upstream_url(request), headers=headers, data=await request.read(), allow_redirects=False)
    except Exception as exc:
        raise web.HTTPBadGateway(text="Terminal backend is unavailable.\n") from exc
    response_headers = {key: value for key, value in upstream.headers.items() if key.lower() not in HOP_HEADERS and key.lower() != "content-length"}
    response = web.StreamResponse(status=upstream.status, reason=upstream.reason, headers=response_headers)
    await response.prepare(request)
    async for chunk in upstream.content.iter_chunked(64 * 1024):
        await response.write(chunk)
    await response.write_eof()
    upstream.release()
    return response


async def proxy_console(request: web.Request) -> web.StreamResponse:
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return await proxy_websocket(request)
    return await proxy_http(request)


async def resources(app: web.Application) -> AsyncIterator[None]:
    config = app[CONFIG_KEY]
    config.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    config.ssh_known_hosts_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if tmux_tmpdir := os.environ.get("TMUX_TMPDIR"):
        os.makedirs(tmux_tmpdir, mode=0o700, exist_ok=True)
    app[CLIENT_KEY] = ClientSession(timeout=ClientTimeout(total=None, connect=10), auto_decompress=False)
    environment = os.environ.copy()
    environment.update(config.launcher_environment())
    command = [
        config.ttyd_bin, "-i", "127.0.0.1", "-p", str(config.ttyd_port), "-b", "/console", "-a", "-W",
        "-t", "fontSize=14", "-t", "cursorStyle=bar", "-t", "scrollback=100000",
        "-t", "disableLeaveAlert=true",
        "-t", 'theme={"background":"#020704","foreground":"#baffd5","cursor":"#6cffaa","selection":"#1b6d3d","black":"#001d0b","brightGreen":"#79ffad","green":"#39d477"}',
        sys.executable, "-m", "termdock.launcher",
    ]
    ttyd = await asyncio.create_subprocess_exec(*command, env=environment)
    for _ in range(40):
        if ttyd.returncode is not None:
            raise RuntimeError(f"ttyd exited during startup with status {ttyd.returncode}")
        try:
            _reader, writer = await asyncio.open_connection("127.0.0.1", config.ttyd_port)
            writer.close()
            await writer.wait_closed()
            break
        except OSError:
            await asyncio.sleep(0.05)
    else:
        raise RuntimeError("ttyd did not start listening")
    yield
    await app[CLIENT_KEY].close()
    if ttyd.returncode is None:
        ttyd.terminate()
        try:
            await asyncio.wait_for(ttyd.wait(), timeout=5)
        except asyncio.TimeoutError:
            ttyd.kill()
            await ttyd.wait()


def create_app(config: Config, *, manage_ttyd: bool = True) -> web.Application:
    app = web.Application(middlewares=[secure_middleware])
    app[CONFIG_KEY] = config
    app[TABS_KEY] = TabStore(config.state_dir, config.tmux_bin, config.tmux_socket, config.session_prefix)
    app.router.add_get("/", index)
    app.router.add_get("/healthz", health)
    app.router.add_get("/static/{name}", asset)
    app.router.add_get("/api/tabs", list_tabs)
    app.router.add_post("/api/tabs", create_tab)
    app.router.add_delete(r"/api/tabs/{tab_id:main|[a-f0-9]{12}}", delete_tab)
    app.router.add_route("*", "/console/{tail:.*}", proxy_console)
    if manage_ttyd:
        app.cleanup_ctx.append(resources)
    else:
        app.cleanup_ctx.append(client_only)
    return app


async def client_only(app: web.Application) -> AsyncIterator[None]:
    app[CLIENT_KEY] = ClientSession(timeout=ClientTimeout(total=None, connect=10), auto_decompress=False)
    yield
    await app[CLIENT_KEY].close()


def main() -> None:
    try:
        config = Config.from_env()
    except ValueError as exc:
        raise SystemExit(f"Configuration error: {exc}") from exc
    web.run_app(create_app(config), host=config.host, port=config.port, access_log_format='%a "%r" %s %b')


if __name__ == "__main__":
    main()
