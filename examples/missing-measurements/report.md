# A blank reading can be a clue

## Background

Imagine a sensor that stops reporting when it gets too hot. Filling the blank with its average makes the input look ordinary. But the blank itself may be a warning.

This example uses a known idea: add a yes/no input saying which readings were missing. The data are generated locally. Team meetings and votes are scripted examples.

## Progress

We compared two simple predictors on separate test data. Both filled gaps using training-set averages. Only one received the extra missing-reading flags.

With overload-related failures, error fell from 1.613 to 1.211: **25.0% lower**. When readings disappeared at random, the flags gave no benefit.

This supports the mechanism in this toy example. It does not establish a new research contribution or a real-world improvement.

## Next Steps

Find real data that records sensor failures. Check whether the pattern changes over time, and test on a later period. Keep the average-filling baseline.

Rerun the example with `python3 examples/missing-measurements/run.py`. Inspect all per-seed values in `results.json`.
