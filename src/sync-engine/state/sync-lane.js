function attachLane(engine) {
  engine._lane = Promise.resolve();
  engine._laneDepth = 0;
  engine._laneStarted = 0;
  engine.serial = function serial(fn) {
    const run = async () => {
      engine._laneDepth++;
      engine._laneStarted++;
      try {
        return await fn();
      } finally {
        engine._laneDepth--;
      }
    };
    const result = engine._lane.then(run, run);
    engine._lane = result.catch(() => {});
    return result;
  };
  engine.inLane = function inLane() {
    return engine._laneDepth > 0;
  };
}

module.exports = { attachLane };
