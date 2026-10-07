# A blank reading can be a clue

Imagine a sensor that stops reporting more often when its input is high. Filling a blank with the average hides that warning. The tested method adds one yes/no input per sensor to say whether its reading was missing.

This is a **known missing-value indicator method**, used here to demonstrate a research workflow. The [scikit-learn guide](https://scikit-learn.org/stable/modules/impute.html#marking-imputed-values) explains the idea. The library also lists a [paper about chained imputation](https://www.jstatsoft.org/article/view/v045i03) as an untested alternative. Its PDF is not bundled and no full-paper reading is claimed.

## Rerun

From the repository root:

```sh
npm run example
```

Or run `run.py` followed by `project.py` with Python. No packages, network, or AI account are needed. Fixed random seeds make the data and results repeatable. Floating-point rounding may differ slightly across Python versions.

`run.py` generates three independent normal sensor inputs. The target is `2*a - 1.5*b + 0.8*c + noise`, with noise standard deviation 0.3. Sensor A goes blank with probability 0.1 for ordinary readings and 0.3, 0.6, or 0.9 when its value exceeds 0.7. B and C go blank independently with probability 0.12. The control makes A go blank at the same expected overall rate, independently of its reading.

Both predictors fit a linear model after filling blanks with training-set means. Only the tested method receives three extra missingness flags. Every fit uses 4,000 training rows and 2,000 independent test rows; five seeds are run for each condition. Means and coefficients never use test rows. A tiny numerical ridge of `1e-6` is applied equally to non-intercept coefficients.

At the strongest overload setting, average test error falls from about **1.613 to 1.211**, or **25.0%**. Under the matched random-missingness control, it changes from about **1.249 to 1.251**: no improvement. The chart metric is root mean squared error in arbitrary target units. Lower is better.

These results are limited to this simple artificial rule. The charts show averages, not confidence intervals. All individual seed results are available for inspection; there is no claim about real hardware, a new method, or a general performance gain.

## Files

- `run.py`: data generation, training, controls, and scoring.
- `sample.csv`: the first train/test split at the strongest overload setting.
- `results.json`: every seed and aggregate result.
- `project.py`: creates the dashboard snapshot from those measured results.
- `project.json`: sample team, proposals, methods, meetings, library, and timeline.
- `report.md`: a short explanation of the findings.

Meetings, votes, replies, names, times, and the recovery event are **scripted examples**, not logs of an actual agent run. `npm run demo` serves them from an in-memory database and cannot dispatch tasks. Restarting resets only this isolated demo.
