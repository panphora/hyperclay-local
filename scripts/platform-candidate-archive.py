import pathlib
import sys
import tarfile


def safe_path(root, path):
    if path.is_absolute() or '\\' in str(path) or ':' in str(path):
        raise ValueError('Unsafe candidate path: ' + str(path))
    target = root.joinpath(path).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Candidate path escapes root: ' + str(path))
    return target


archive, destination = map(pathlib.Path, sys.argv[1:3])
destination.mkdir(parents=True, exist_ok=True)
root = destination.resolve()
with tarfile.open(archive, 'r:gz') as source:
    for member in source:
        name = pathlib.PurePosixPath(member.name)
        if '..' in name.parts:
            raise ValueError('Unsafe candidate path: ' + member.name)
        safe_path(root, name)
        if member.issym() or member.islnk():
            link = pathlib.PurePosixPath(member.linkname)
            if link.is_absolute() or '\\' in member.linkname or ':' in member.linkname:
                raise ValueError('Unsafe candidate link: ' + member.linkname)
            safe_path(root, name.parent / link if member.issym() else link)
        elif not (member.isfile() or member.isdir()):
            raise ValueError('Candidate contains a special file: ' + member.name)
        source.extract(member, destination)
