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

## Layout

```
index.html          arcade front end
dashboard.html      engine dashboard
css/                styles for each page
js/engine.js        pattern models, Bayesian updating, test selection, simulation
js/tasks.js         browser implementations of the 11 tasks
js/arcade.js        arcade UI
js/dashboard.js     dashboard UI
tools/simulate.js   Monte Carlo evaluation (Node)
```

## Next steps

- Replace the placeholder norms with age-stratified norms collected for these browser versions.
- Fit the pattern means and σ to clinical data instead of hand-set values.
- Add a real lexicon check for the fluency tasks. They currently check only format and the starting letter.
