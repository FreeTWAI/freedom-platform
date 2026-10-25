"""Read one bounded receipt in memory. Never extract paths or execute archive code."""
import io
import stat
import sys
import zipfile


def receipt():
    data = sys.stdin.buffer.read(1_000_001)
    if not 0 < len(data) <= 1_000_000:
        raise ValueError()
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) != 1:
            raise ValueError()
        entry = entries[0]
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if (entry.filename != "receipt.json" or entry.is_dir()
                or kind not in (0, stat.S_IFREG) or entry.flag_bits & 1
                or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                or not 0 < entry.file_size <= 65_536 or entry.compress_size > 1_000_000):
            raise ValueError()
        with archive.open(entry) as stream:
            value = stream.read(65_537)
        if len(value) != entry.file_size or len(value) > 65_536:
            raise ValueError()
        value.decode("utf-8", errors="strict")
        return value


if __name__ == "__main__":
    try:
        sys.stdout.buffer.write(receipt())
    except Exception:
        # No archive name, provider URL, input bytes or Python traceback in logs.
        sys.exit(1)
