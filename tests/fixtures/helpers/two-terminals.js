// Structured helper fixture: two terminal records, which the host refuses.
process.stdout.write('{"type":"result","value":1}\n');
process.stdout.write('{"type":"result","value":2}\n');
