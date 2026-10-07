"""A tiny repeatable experiment, using only Python's standard library.

This demonstrates a known missing-value indicator method, not a novel finding.
The generated rows are independent. Split before fitting any means or weights.
"""
import csv
import json
import math
import random
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRAIN_ROWS, TEST_ROWS = 4000, 2000
SEEDS = [11, 22, 33, 44, 55]


def generate(seed, count, high_missing, informative=True):
    rng = random.Random(seed)
    rows = []
    # P(N(0,1)>0.7). The random control has the same expected missing rate.
    tail = 0.5 * math.erfc(0.7 / math.sqrt(2))
    rate = 0.1 + tail * (high_missing - 0.1)
    for _ in range(count):
        sensors = [rng.gauss(0, 1) for _ in range(3)]
        target = 2 * sensors[0] - 1.5 * sensors[1] + 0.8 * sensors[2] + rng.gauss(0, 0.3)
        chance = (high_missing if sensors[0] > 0.7 else 0.1) if informative else rate
        missing = [rng.random() < chance, rng.random() < 0.12, rng.random() < 0.12]
        rows.append(([None if absent else x for x, absent in zip(sensors, missing)], target))
    return rows


def solve(matrix, rhs):
    """Small pivoted linear solve; only 4 or 7 coefficients in this example."""
    n = len(rhs)
    a = [row[:] + [b] for row, b in zip(matrix, rhs)]
    for j in range(n):
        pivot = max(range(j, n), key=lambda i: abs(a[i][j]))
        a[j], a[pivot] = a[pivot], a[j]
        if abs(a[j][j]) < 1e-12:
            raise ValueError('Singular fit')
        scale = a[j][j]
        a[j] = [v / scale for v in a[j]]
        for i in range(n):
            if i != j:
                factor = a[i][j]
                a[i] = [v - factor * w for v, w in zip(a[i], a[j])]
    return [row[-1] for row in a]


def fit_and_score(train, test, indicators):
    means = [statistics.mean(x[j] for x, _ in train if x[j] is not None) for j in range(3)]
    def features(row):
        return [1.0] + [means[j] if v is None else v for j, v in enumerate(row)] + ([float(v is None) for v in row] if indicators else [])
    n = 7 if indicators else 4
    gram = [[0.0] * n for _ in range(n)]
    rhs = [0.0] * n
    for row, target in train:
        x = features(row)
        for i in range(n):
            rhs[i] += x[i] * target
            for j in range(n):
                gram[i][j] += x[i] * x[j]
    # Tiny numerical ridge, identical for both methods; do not penalize intercept.
    for i in range(1, n):
        gram[i][i] += 1e-6
    weights = solve(gram, rhs)
    return math.sqrt(statistics.mean((sum(w * v for w, v in zip(weights, features(row))) - y) ** 2 for row, y in test))


def experiment():
    results = []
    for informative in [True, False]:
        for rate in [0.3, 0.6, 0.9]:
            runs = []
            for seed in SEEDS:
                train = generate(seed, TRAIN_ROWS, rate, informative)
                test = generate(seed + 10000, TEST_ROWS, rate, informative)
                scores = {key: fit_and_score(train, test, indicators) for key, indicators in [('fill_only', False), ('missing_flags', True)]}
                runs.append({'seed': seed, **scores})
            means = {key: statistics.mean(r[key] for r in runs) for key in ['fill_only', 'missing_flags']}
            results.append({'pattern': 'overload' if informative else 'random', 'high_missing_probability': rate, 'runs': runs, 'mean_rmse': means, 'mean_improvement_percent': 100 * (1 - means['missing_flags'] / means['fill_only'])})
    return {'schema_version': 1, 'data': 'synthetic independent sensor readings', 'train_rows_per_seed': TRAIN_ROWS, 'test_rows_per_seed': TEST_ROWS, 'seeds': SEEDS, 'metric': 'root mean squared error; lower is better', 'results': results}


if __name__ == '__main__':
    output = experiment()
    (HERE / 'results.json').write_text(json.dumps(output, indent=2) + '\n')
    with (HERE / 'sample.csv').open('w', newline='') as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(['split', 'sensor_a', 'sensor_b', 'sensor_c', 'target'])
        for split, seed, count in [('train', SEEDS[0], TRAIN_ROWS), ('test', SEEDS[0] + 10000, TEST_ROWS)]:
            for x, target in generate(seed, count, 0.9):
                writer.writerow([split, *x, target])
    for row in output['results']:
        print(row['pattern'], row['high_missing_probability'], {k: round(v, 3) for k, v in row['mean_rmse'].items()})
