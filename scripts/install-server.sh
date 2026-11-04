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


def has_marker(path, marker):
    encoded = marker.encode("utf8")
    with path.open("rb") as stream:
        return stream.read(len(encoded)) == encoded


def check_command(command, root):
    if command == root / "bin/zcode":
        return  # 直接使用既有稳定入口时不写 PATH 包装器。
    if command.is_symlink():
        target = command.resolve()
        legacy_releases = (Path.home() / ".local/share/zcode-server/releases").resolve()
        legacy = (target.parent.parent == legacy_releases and target.name == ".installer-launcher"
                  and target.is_file()
                  and has_marker(target, "#!/bin/sh\n# zcode-server installer\n"))
        require(target == root / "bin/zcode" or legacy,
                "Refusing to replace unrelated command: " + str(command))
    else:
        require(not command.exists() or (command.is_file() and has_marker(command,
            "#!/bin/sh\n# zcode-server unified installer\n")),
            "Refusing to replace existing command: " + str(command))


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
    require(not os.environ.get("ZCODE_SERVER_INSTALL_DIR"),
            "ZCODE_SERVER_INSTALL_DIR is no longer supported; use ZCODE_DATA_BASE_DIR (Server root: <base>/.zcode/server)")
    root = install_path("ZCODE_DATA_BASE_DIR", Path.home()) / ".zcode/server"
    root = root.resolve()
    bin_dir = install_path("ZCODE_SERVER_BIN_DIR", Path.home() / ".local/bin")
    command = bin_dir / "zcode"
    stable = root / "bin/zcode"
    check_command(command, root)

    with tempfile.TemporaryDirectory(prefix="zcode-server-download-") as temp:
        temp = Path(temp)
        index = temp / "index"
        if dev:
            base = DOWNLOADS + "/server-canary-build"
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
        if dev:
            version = descriptor.get("version", "")
            require(VERSION.fullmatch(version) is not None and "-dev." in version,
                    "Canary descriptor must declare a dev version")
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

        with tarfile.open(archive_path, "r:gz") as archive:
            validate_archive(archive, name, version, target)
            staging = temp / "bootstrap"
            staging.mkdir()
            extract_archive(archive, staging)
        unpacked = staging / name
        for relative in ("bin/zcode", "runtime/node", "runtime/server-cli.js", "runtime/provider/zcode-builtin.json"):
            require((unpacked / relative).is_file(), "Missing packaged entry: " + relative
                    + "; publish a complete Source Server release before retrying")
        for relative in ("bin/zcode", "runtime/node"):
            require(os.access(unpacked / relative, os.X_OK), "Packaged entry is not executable: " + relative)
        # 复用 SSH 的唯一安装 owner：不自行发布版本目录、current 或完整性记录。
        update_args = [str(unpacked / "bin/zcode"), "update", "--from-archive", str(archive_path),
                       "--server-root", str(root), "--json"]
        if dev:
            update_args.insert(-1, "--allow-downgrade")
        result = subprocess.run(update_args)
        require(result.returncode == 0, "Server installation command failed (exit " + str(result.returncode)
                + "): " + shlex.join(update_args))
        require(stable.is_file(), "Server installation did not create stable launcher: " + str(stable))
        if command != stable:
            bin_dir.mkdir(parents=True, exist_ok=True)
            check_command(command, root)
            stable_command = shlex.quote(str(stable))
            wrapper = ('#!/bin/sh\n# zcode-server unified installer\n'
                       'for arg in "$@"; do\n'
                       '  if [ "$arg" = "--server-root" ]; then exec ' + stable_command + ' "$@"; fi\n'
                       'done\nexec ' + stable_command + ' "$@" --server-root ' + shlex.quote(str(root)) + '\n')
            with tempfile.TemporaryDirectory(prefix=".zcode-command-", dir=bin_dir) as command_temp:
                staged_command = Path(command_temp) / "zcode"
                staged_command.write_text(wrapper)
                staged_command.chmod(0o755)
                os.replace(staged_command, command)

    print("ZCode Server " + version + " installed: " + str(command))
    print("Run: zcode server connect\nThen: zcode server up -d\nLogs: zcode server logs -f\nLogout: zcode server logout")
    print("Server root: " + str(root) + " (shared with SSH installations)")
    print("Running-task checks follow the Server updater; no force options are used.")
    if str(bin_dir) not in os.environ.get("PATH", "").split(os.pathsep):
        print("Add to PATH: export PATH=" + shlex.quote(str(bin_dir)) + ':"$PATH"')


try:
    main()
except Exception as error:
    print("ZCode Server install failed: " + type(error).__name__ + ": " + str(error), file=sys.stderr)
    sys.exit(1)
PY
