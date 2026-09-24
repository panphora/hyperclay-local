// Structured helper fixture: a helper that fails without a terminal record.
process.stderr.write('boom: config missing\n');
process.exit(3);
