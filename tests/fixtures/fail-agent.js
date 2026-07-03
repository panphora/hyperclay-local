// Generic-contract fixture agent that fails: nonzero exit + stderr.
process.stderr.write('boom: config missing');
process.exit(3);
