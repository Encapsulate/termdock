import asyncio
import base64
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer

from termdock.app import create_app
from termdock.auth import hash_password
from termdock.config import Config


def test_http_auth_csrf_and_security_headers(tmp_path: Path) -> None:
    identity = tmp_path / "identity"
    identity.write_text("test-only", "utf-8")
    config = Config(
        host="127.0.0.1", port=18022, ttyd_port=18023, state_dir=tmp_path / "state",
        web_username="tester", web_password_hash=hash_password("a secure test password", salt=b"0123456789abcdef"),
        tmux_bin="/bin/false", ttyd_bin="/bin/false", ssh_bin="/bin/false",
        ssh_host="127.0.0.1", ssh_port=22, ssh_user="tester", ssh_identity_file=identity,
        ssh_known_hosts_file=tmp_path / "known_hosts", session_prefix="termdock", tmux_socket="termdock",
    )

    async def exercise() -> None:
        client = TestClient(TestServer(create_app(config, manage_ttyd=False)))
        await client.start_server()
        try:
            assert (await client.get("/healthz")).status == 200
            unauthorized = await client.get("/")
            assert unauthorized.status == 401
            assert unauthorized.headers["X-Content-Type-Options"] == "nosniff"
            token = base64.b64encode(b"tester:a secure test password").decode()
            headers = {"Authorization": f"Basic {token}"}
            page = await client.get("/", headers=headers)
            assert page.status == 200
            page_text = await page.text()
            assert "TERMDOCK" in page_text
            assert "two fingers" in page_text
            assert 'data-modifier="ctrl"' in page_text
            assert 'data-modifier="alt"' in page_text
            assert 'data-key="tab"' in page_text
            assert 'data-key="clear"' in page_text
            script = await client.get("/static/app.js", headers=headers)
            assert script.status == 200
            script_text = await script.text()
            assert "installTouchScroll" in script_text
            assert "visualViewport" in script_text
            assert "emitTerminalKey" in script_text
            stylesheet = await client.get("/static/style.css", headers=headers)
            assert stylesheet.status == 200
            assert "--viewport-height" in await stylesheet.text()
            mobile_styles = await client.get("/static/mobile.css", headers=headers)
            assert mobile_styles.status == 200
            assert "compact-mobile" in await mobile_styles.text()
            assert (await client.post("/api/tabs", headers=headers)).status == 403
            created = await client.post("/api/tabs", headers={**headers, "X-TermDock-Request": "1"})
            assert created.status == 201
            assert (await created.json())["name"] == "Terminal 2"
        finally:
            await client.close()

    asyncio.run(exercise())
