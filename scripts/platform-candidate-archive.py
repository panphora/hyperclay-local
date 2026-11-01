import pathlib
import sys
import tarfile

archive, destination = map(pathlib.Path, sys.argv[1:3])
with tarfile.open(archive, 'r:gz') as source:
    members = source.getmembers()
    for member in members:
        name = pathlib.PurePosixPath(member.name)
        if name.is_absolute() or '..' in name.parts or '\\' in member.name or ':' in member.name:
            raise ValueError('Unsafe candidate path: ' + member.name)
        if not (member.isfile() or member.isdir()):
            raise ValueError('Candidate contains a link or special file: ' + member.name)
    destination.mkdir(parents=True, exist_ok=True)
    source.extractall(destination, members=members)
