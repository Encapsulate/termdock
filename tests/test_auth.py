from termdock.auth import decode_basic, hash_password, verify_password


def test_password_hash_round_trip() -> None:
    encoded = hash_password("correct horse battery staple", salt=b"0123456789abcdef")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("incorrect horse battery staple", encoded)
    assert "correct horse" not in encoded


def test_basic_header_decode() -> None:
    assert decode_basic("Basic dXNlcjpwYXNz") == ("user", "pass")
    assert decode_basic("Bearer nope") is None
    assert decode_basic("Basic !!!") is None
