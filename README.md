# Mind Arcade

An adaptive neuropsychological battery presented as an arcade game. Eleven short browser tasks are chosen one at a time by a Bayesian engine. It explores while many cognitive patterns are still plausible, and it exploits once the field narrows to a head-to-head. It stops only when the leading pattern is triangulated by independent tests.

> Research prototype. The norms and pattern models are illustrative placeholders, so this is not a diagnostic instrument.

- **`index.html`**: the arcade front end. It has a level board, a radar of converging hunches, a demo bot, and an examiner view.
- **`dashboard.html`**: the engine dashboard. It shows the posterior, the policy, the next-test ranking with EIG and D, the decision log, and the z-score profile with AACN descriptors.

Both are static pages with no build step. Open them locally or serve them with GitHub Pages.

## The tasks

| Level | Task | Measures |
|---|---|---|
| Echo Chamber | Digit span forward (2 trials/length, discontinue on 2 fails) | span |
| Rewind | Digit span backward | span |
| Dodge the X | Go/no-go (44 trials, 10 no-go) | commission rate, go-RT CV |
| Color Clash | Color–word interference (32 trials) | incongruent − congruent median RT (+ error penalty) |
| Dot Dash | Trail making A and B (16 nodes each) | A time, B − A |
| Word Vault | 10-word list, 2 learning trials | total recall /20 |
| Vault Return | Delayed free recall + yes/no recognition | recall /10, hits − false alarms |
| Animal Stampede | Category fluency, 60 s | unique animals |
| F-Frenzy | Letter fluency (F), 60 s | unique F-words |
| Riddle Me This | Responsive naming, 12 items, stop after 4 misses | correct /12 |
| Flip or Spin | 2D mental rotation, same vs mirror, 5 s limit | accuracy |

## The engine (`js/engine.js`)

**Pattern models.** There are eight candidate patterns: typical, amnestic, dysexecutive, attentional, semantic, visuospatial, psychomotor slowing, and mood-related. Each one predicts a z-score on every one of the 14 measures. Scores are Gaussian around that prediction with σ = 0.7, and measures are conditionally independent given the pattern. The prior is flat.

**Explore.** For each candidate test, the engine computes the expected information gain:

    EIG = H(P) − E[H(P | scores)]

It estimates this with stratified Monte Carlo over the current posterior.

**Exploit.** For the leader *a* and the runner-up *b*, the engine computes the expected log-likelihood ratio between them:

    D = Σ (μa − μb)² / 2σ²

**Blend.** The explore weight is the effective number of live patterns, rescaled to 0–1:

    w = (2^H − 1) / 7

Each candidate's utility is then:

    [w · EIG_n + (1 − w) · D_n] / minutes

EIG_n and D_n are each scaled by the best candidate's value, and dividing by minutes rewards cheap tests.

**Triangulation.** Every completed test is a sightline. A sightline converges when that test's own scores favor the leader over the runner-up by a Bayes factor of 3 or more.

**Confirm phase.** If the leader passes 90% but fewer than two sightlines converge, the engine prefers a test from a domain that has not yet converged.

**Stopping.** The session ends in one of three ways:
- **Converged:** P ≥ 0.90 and at least two converging tests.
- **Single-line:** P ≥ 0.97 and no remaining test separates the top two.
- **Unresolved:** the battery is exhausted.

Delayed recall unlocks two tests after list learning. Until then, the engine picks filler tests.

## Simulation

```
node tools/simulate.js 100
```

This runs simulated sessions for each true profile and reports completion time, stop type, and accuracy.

With 100 sessions per profile, the engine averages about 12 minutes, against 16.6 minutes for the full battery. When it converges, it is almost always correct. Overlapping profiles (mood, slowing, mixed) mostly end unresolved, which is the intended behavior.

## v2: model-based branch

On the `model-based` branch, three tasks are fit with generative process models at the trial level instead of being reduced to summary scores.

| Task | Data kept | Model | Parameters |
|---|---|---|---|
| Word Vault + Vault Return (12 words × 3 trials, delay, 24-item recognition) | recall count per trial, delayed recall, hits and false alarms, delay in minutes | storage `1 − (1 − e)ⁿ`, recall = storage × access `r`, decay `e^(−fD)`, two-high-threshold recognition | encoding `e`, retrieval access `r`, forgetting `f` |
| Animal Stampede / F-Frenzy | timestamp of every valid entry | Poisson depletion of a finite pool, rate `(N/τ)e^(−t/τ)` (Bousfield & Sedgewick; Wixted & Rohrer) | pool size `N`, search time constant `τ` |
| Flip or Spin (20 trials, angles 40–160°) | RT and accuracy per trial | RT = non-decision + angle/ω + Wiener first-passage time (Navarro & Fuss density) | rotation rate `ω`, drift `v` (boundary and non-decision time are nuisance parameters) |

**Inference.**
- Each pattern is a distribution over parameters, as well as over the classic scores.
- Model tests score each pattern by its exact marginal likelihood, integrated over the fitted grid. This handles trade-offs between parameters, such as encoding versus access.
- Classic scores keep the z-score likelihood.
- Delayed recall supersedes learning in the posterior. As a triangulation sightline, it counts only the evidence the delay added.

**Predictions.**
- Before each test, the engine commits to an 80% predictive band for every measure. The dashboard's ledger scores each band once the test is done.
- After list learning, the engine also predicts delayed recall and recognition mechanistically, by importance sampling memory parameters conditioned on the learning curve.

**Validation (simulation):**
- `node tools/recovery.js 150` checks parameter recovery. Rotation rate recovers well (r ≈ 0.95). Memory and fluency parameters recover moderately (r ≈ 0.5–0.65) from a single short administration. Their 80% intervals cover the true value about 87–94% of the time, so the error bars are slightly conservative.
- In full sessions, the 80% prediction bands contain about 86% of observations. Delayed recall is predicted to within about 1.4 words (mean absolute error) from learning trials alone. When a session converges, the leader is correct about 97% of the time.
- `node tools/simulate.js 60` gives completion time and accuracy by profile.

**Data to replace the placeholders.**
- **ADNI:** RAVLT trials 1–5, delayed recall and recognition, with diagnosis and biomarkers. The memory model can be fit directly.
- **NACC UDS:** pattern templates learned from clinician diagnoses.
- **Cam-CAN:** age-stratified norms with trial-level data.
- **Time-stamped fluency:** rare in existing datasets. The arcade collects it.

## Fitting to ADNI

**Step-by-step access and one-command run: [docs/ADNI.md](docs/ADNI.md)** (`./tools/adni.sh` after download).

`tools/fit_adni.js` fits the arcade's memory model to ADNI's RAVLT data (15 words × 5 trials, a 30-minute delay, and recognition). It also learns diagnosis templates. ADNI data needs an approved LONI account and can't be redistributed, so run it locally on your own download:

```
node tools/fit_adni.js --neurobat NEUROBAT.csv --dx ADNIMERGE.csv --write-engine
```

**Steps:**
1. **Per-participant fits.** For each baseline participant, the script computes the likelihood of encoding `e`, retrieval access `r` and forgetting `f`, using the same model the arcade uses with only the list design changed. Guess bias is marginalized.
2. **Group templates.** For each diagnosis (CN/SMC, EMCI, LMCI, AD), hierarchical EM estimates the group's mean and spread.
3. **Cross-validated benchmark.** Five-fold cross-validation classifies diagnosis from RAVLT alone with three methods: the model's exact marginal likelihood (what the engine does), LDA on the fitted parameters, and LDA on classic summary scores (immediate total, learning, delayed, % forgetting, recognition).
4. **Outputs.** The script writes `data/adni_fit.json`. With `--write-engine`, it also writes `js/adni-fit.js`. This re-centers the memory norms on cognitively normal ADNI participants, swaps the amnestic template for the late-MCI fit, and links the file from both pages.

**Column names.** The defaults are `AVTOT1`–`AVTOT5`, `AVDEL30MIN`, `AVDELTOT` (recognition hits), `AVDELERR2` (recognition false positives), `DX_bl`, `RID` and `VISCODE`. Override any of them with `--map key=COLUMN`. The script prints the range of each field so you can confirm the mapping against the data dictionary.

**Pipeline check.** `node tools/fit_adni.js --synthetic 1200` runs the same steps on simulated ADNI-shaped data with known group means, and the means are recovered closely.

## Layout

```
index.html          arcade front end
dashboard.html      engine dashboard
css/                styles for each page
js/engine.js        pattern models, Bayesian updating, test selection, simulation
js/tasks.js         browser implementations of the 11 tasks
js/arcade.js        arcade UI
js/dashboard.js     dashboard UI
tools/simulate.js   Monte Carlo evaluation of whole sessions (Node)
tools/recovery.js   parameter recovery for the generative models (Node)
tools/fit_adni.js   fit the memory model and diagnosis templates to ADNI RAVLT (Node)
data/               fit outputs
```

## Next steps

- Replace the placeholder norms with age-stratified norms collected for these browser versions.
- Fit the pattern means and σ to clinical data instead of hand-set values.
- Add a real lexicon check for the fluency tasks. They currently check only format and the starting letter.
