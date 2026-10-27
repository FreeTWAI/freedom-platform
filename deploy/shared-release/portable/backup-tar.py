"""Bounded, private TAR transport. Never executes or extracts provider paths."""
import io
import os
import re
import stat
import sys
import tarfile

MAX = 128 * 1024 * 1024
MEMBER_MAX = 64 * 1024 * 1024 + 4096


def valid(name):
    parts = name.split('/')
    return (name == 'control.json' or (parts[0] in ('sealed', 'objects') and len(parts) > 1)) and all(
        re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,127}', p) and p not in ('.', '..') for p in parts)


def syncdir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run():
    mode, root = sys.argv[1:]
    assert os.path.realpath(root) == root and stat.S_ISDIR(os.lstat(root).st_mode)
    if mode == 'pack':
        names = []
        for folder, dirs, files in os.walk(root, followlinks=False):
            for name in dirs:
                assert not os.path.islink(os.path.join(folder, name))
            for name in files:
                path = os.path.join(folder, name)
                relative = os.path.relpath(path, root)
                assert valid(relative) and stat.S_ISREG(os.lstat(path).st_mode)
                names.append(relative)
                assert len(names) <= 4096
        assert 'control.json' in names
        output = io.BytesIO()
        total = 0
        with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for name in sorted(names):
                fd = os.open(os.path.join(root, name), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                with os.fdopen(fd, 'rb') as body:
                    info = os.fstat(body.fileno())
                    assert stat.S_ISREG(info.st_mode) and 0 <= info.st_size <= MEMBER_MAX
                    total += info.st_size
                    assert total <= MAX
                    member = tarfile.TarInfo(name)
                    member.size = info.st_size
                    member.mode = 0o600
                    archive.addfile(member, body)
                assert output.tell() <= MAX
        assert output.tell() <= MAX
        sys.stdout.buffer.write(output.getvalue())
    elif mode == 'unpack':
        assert not os.listdir(root)
        data = sys.stdin.buffer.read(MAX + 1)
        assert 0 < len(data) <= MAX
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
            # Validate the entire member inventory before creating any paths.
            members, names, total = [], set(), 0
            for member in archive:
                assert member.isfile() and not member.issparse() and valid(member.name)
                assert member.name not in names and 0 <= member.size <= MEMBER_MAX
                names.add(member.name)
                members.append(member)
                total += member.size
                assert len(members) <= 4096 and total <= MAX
            assert 'control.json' in names
            for name in names:
                parts = name.split('/')
                assert all('/'.join(parts[:i]) not in names for i in range(1, len(parts)))
            for member in members:
                path = os.path.join(root, member.name)
                os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as output, archive.extractfile(member) as body:
                    remaining = member.size
                    while remaining:
                        chunk = body.read(min(1024 * 1024, remaining))
                        assert chunk
                        output.write(chunk)
                        remaining -= len(chunk)
                    output.flush()
                    os.fsync(output.fileno())
            for folder, _, _ in os.walk(root, topdown=False):
                syncdir(folder)
    else:
        raise ValueError()


try:
    run()
except Exception:
    sys.exit(1)
