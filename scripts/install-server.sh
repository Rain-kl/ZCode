#!/bin/sh
set -eu

for tool in curl python3; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "ZCode Server install requires $tool (Python 3.8+)." >&2
    exit 1
  }
done

python3 - "$@" <<'PY'
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shlex
import subprocess
import sys
import tarfile
import tempfile

REPO = "Rain-kl/ZCode"
DOWNLOADS = "https://github.com/" + REPO + "/releases/download"
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def download(url, destination):
    print("Downloading " + url, flush=True)
    result = subprocess.run([
        "curl", "--fail", "--location", "--silent", "--show-error",
        "--proto", "=https", "--proto-redir", "=https",
        "--connect-timeout", "15", "--max-time", "900", "--retry", "3",
        "--output", str(destination), url,
    ], stderr=subprocess.PIPE, text=True)
    require(result.returncode == 0,
            "Download failed: " + url + " (curl " + str(result.returncode) + "): " + result.stderr.strip())


def install_path(variable, default):
    path = Path(os.environ.get(variable, str(default)))
    require(path.is_absolute(), variable + " must be an absolute path")
    return path.resolve()


def check_command(command, releases):
    if command.is_symlink():
        target = command.resolve()
        require(target.parent.parent == releases and target.name == ".installer-launcher"
                and target.is_file()
                and target.read_text().startswith("#!/bin/sh\n# zcode-server installer\n"),
                "Refusing to replace unrelated command: " + str(command))
    else:
        require(not command.exists(), "Refusing to replace existing command: " + str(command))


def validate_archive(archive, name, version, target):
    members = archive.getmembers()
    for member in members:
        path = PurePosixPath(member.name)
        require(not path.is_absolute() and ".." not in path.parts
                and path.parts and path.parts[0] == name,
                "Unsafe archive path: " + member.name)
        require(member.isfile() or member.isdir() or member.issym() or member.islnk(),
                "Unsafe archive entry type: " + member.name)
        if member.issym() or member.islnk():
            link = member.linkname
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), link)
                                          if member.issym() else link)
            require(not link.startswith("/") and resolved.startswith(name + "/"),
                    "Unsafe archive link: " + member.name + " -> " + link)
    manifest_member = archive.getmember(name + "/manifest.json")
    require(manifest_member.isfile(), "Invalid manifest entry")
    with archive.extractfile(manifest_member) as stream:
        manifest = json.load(stream)
    require(manifest.get("product") == "zcode-server"
            and manifest.get("appVersion") == version and manifest.get("target") == target,
            "Archive manifest mismatch for " + version + "/" + target)


def extract_archive(archive, staging):
    if hasattr(tarfile, "data_filter"):
        archive.extractall(staging, filter="data")
        return
    # 旧 Python 尚无 data_filter；逐条按真实路径检查，防止软链接链绕过词法路径校验。
    boundary = Path(staging).resolve()
    for member in archive.getmembers():
        output = boundary / member.name
        output.resolve().relative_to(boundary)
        if member.issym() or member.islnk():
            link = output.parent / member.linkname if member.issym() else boundary / member.linkname
            link.resolve().relative_to(boundary)
        archive.extract(member, staging)


def main():
    require(sys.version_info >= (3, 8), "Python 3.8+ is required")
    require(sys.argv[1:] in ([], ["dev"]), "Usage: sh install-server.sh [dev]")
    dev = sys.argv[1:] == ["dev"]
    system = subprocess.check_output(["uname", "-s"], text=True).strip()
    machine = subprocess.check_output(["uname", "-m"], text=True).strip()
    require(system in ("Linux", "Darwin"), "Unsupported OS: " + system)
    arch = {"x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(machine)
    require(arch is not None, "Unsupported CPU architecture: " + machine)
    target = ("linux" if system == "Linux" else "darwin") + "-" + arch
    root = install_path("ZCODE_SERVER_INSTALL_DIR", Path.home() / ".local/share/zcode-server")
    bin_dir = install_path("ZCODE_SERVER_BIN_DIR", Path.home() / ".local/bin")
    releases = root / "releases"
    command = bin_dir / "zcode"
    check_command(command, releases)

    with tempfile.TemporaryDirectory(prefix="zcode-server-download-") as temp:
        temp = Path(temp)
        index = temp / "index"
        if dev:
            download(DOWNLOADS + "/canary-build/dev.yml", index)
            versions = re.findall(r"^version: *([^\s]+) *$", index.read_text(), re.MULTILINE)
            require(len(versions) == 1, "Invalid canary dev.yml version")
            version = versions[0]
            require("-dev." in version, "Canary version must be a dev release")
        else:
            download("https://api.github.com/repos/" + REPO + "/releases/latest", index)
            release = json.loads(index.read_text())
            require(release.get("prerelease") is False and release.get("draft") is False,
                    "Invalid stable release response")
            tag = release.get("tag_name", "")
            require(isinstance(tag, str) and tag.startswith("v"), "Invalid stable release tag")
            version = tag[1:]
            require("-" not in version, "Stable version cannot be a prerelease")
        require(VERSION.fullmatch(version) is not None, "Invalid release version: " + version)
        base = DOWNLOADS + "/server-v" + version
        descriptor_path = temp / "descriptor.json"
        download(base + "/source-server-release.json", descriptor_path)
        descriptor = json.loads(descriptor_path.read_text())
        require(descriptor.get("schemaVersion") == 1 and descriptor.get("version") == version,
                "Invalid Source Server descriptor schema/version")
        entries = descriptor.get("archives")
        require(isinstance(entries, list), "Invalid descriptor archives")
        entries = [entry for entry in entries if isinstance(entry, dict) and entry.get("target") == target]
        require(len(entries) == 1, "Descriptor must contain exactly one archive for " + target)
        entry = entries[0]
        name = "zcode-server-" + target
        filename = name + ".tar.gz"
        digest = entry.get("sha256")
        size = entry.get("sizeBytes")
        require(entry.get("version") == version and entry.get("fileName") == filename
                and entry.get("urls") == [filename]
                and isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest)
                and type(size) is int and size > 0,
                "Invalid archive descriptor for " + target)
        archive_path = temp / filename
        download(base + "/" + filename, archive_path)
        require(archive_path.stat().st_size == size, "Archive size mismatch: " + filename)
        checksum = hashlib.sha256()
        with archive_path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                checksum.update(chunk)
        require(checksum.hexdigest() == digest, "Archive SHA256 mismatch: " + filename)

        destination = releases / (version + "-" + target + "-" + digest)
        launcher = destination / ".installer-launcher"
        wrapper = "#!/bin/sh\n# zcode-server installer\nexec " + shlex.quote(str(destination / "bin/zcode")) + ' "$@"\n'
        with tarfile.open(archive_path, "r:gz") as archive:
            validate_archive(archive, name, version, target)
            releases.mkdir(parents=True, exist_ok=True)
            # 与最终目录同一文件系统；下载/验证失败不会触碰现有运行文件或命令。
            with tempfile.TemporaryDirectory(prefix=".install-", dir=releases) as staging:
                extract_archive(archive, staging)
                unpacked = Path(staging) / name
                for relative in ("bin/zcode", "runtime/node", "runtime/server-cli.js"):
                    require((unpacked / relative).is_file(), "Missing packaged entry: " + relative)
                for relative in ("bin/zcode", "runtime/node"):
                    require(os.access(unpacked / relative, os.X_OK), "Packaged entry is not executable: " + relative)
                (unpacked / ".installer-launcher").write_text(wrapper)
                (unpacked / ".installer-launcher").chmod(0o755)
                if destination.exists():
                    require(launcher.is_file() and launcher.read_text() == wrapper,
                            "Refusing to overwrite existing release directory: " + str(destination))
                else:
                    unpacked.rename(destination)
        bin_dir.mkdir(parents=True, exist_ok=True)
        check_command(command, releases)
        with tempfile.TemporaryDirectory(prefix=".zcode-link-", dir=bin_dir) as link_temp:
            link = Path(link_temp) / "zcode"
            link.symlink_to(launcher)
            os.replace(link, command)

    print("ZCode Server " + version + " installed: " + str(command))
    print("Run: zcode server connect\nThen: zcode server up -d\nLogs: zcode server logs -f")
    print("For upgrades: stop the existing service with zcode server down before installing; start it again afterward.")
    if str(bin_dir) not in os.environ.get("PATH", "").split(os.pathsep):
        print("Add to PATH: export PATH=" + shlex.quote(str(bin_dir)) + ':"$PATH"')


try:
    main()
except Exception as error:
    print("ZCode Server install failed: " + type(error).__name__ + ": " + str(error), file=sys.stderr)
    sys.exit(1)
PY
