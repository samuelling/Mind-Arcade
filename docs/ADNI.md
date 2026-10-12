# Getting ADNI data into Mind Arcade

## 1. Apply (about 10 minutes, once)

Go to [adni.loni.usc.edu → Data & Samples → Access Data](https://adni.loni.usc.edu/?p=68) and start the online application. It creates your LONI IDA account and asks for your affiliation, your proposed use, and acceptance of the Data Use Agreement. The Data Sharing and Publications Committee usually replies by email within about two weeks.

Paste these answers into the form:

**Institution:** Boston University, Department of Psychological & Brain Sciences

**Investigator role:** Principal Investigator (faculty)

**Project title:** Generative process models of verbal learning for adaptive cognitive assessment

**Proposed use of ADNI data:**

> We are developing an adaptive, computerized cognitive assessment in which test selection and diagnostic inference rest on generative process models fit to trial-level data rather than on summary scores. For verbal memory, the model separates encoding rate, retrieval access, and forgetting rate, with a threshold model of recognition. We will use baseline RAVLT trial scores (trials 1–5, 30-minute delayed recall, recognition hits and false positives) and baseline diagnosis (ADNIMERGE) to:
> (1) estimate normative parameter distributions in cognitively normal participants;
> (2) estimate hierarchical parameter templates for EMCI, LMCI and AD dementia; and
> (3) test, with cross-validation, whether model-based parameters classify diagnosis better than conventional RAVLT summary scores.
>
> Analyses use de-identified tabular data only. Participant-level data will be stored on access-controlled institutional systems and will not be redistributed. Only aggregate parameters will be reported, with the ADNI acknowledgment required by the Data Use Agreement.

**Data requested:** NEUROBAT (Neuropsychological Battery) and ADNIMERGE.

## 2. Once approved: download two tables

Log in to the IDA, open the ADNI project and go to **Download → Study Data**. Download:

- **Neuropsychological Battery**: `NEUROBAT.csv`. In the Study Data tree it is under Assessments → Neuropsychological.
- **ADNIMERGE**: `ADNIMERGE.csv`, the merged table of key variables. It is under Study Info.

Leave both files in your Downloads folder.

## 3. Run one command

From the repo folder:

```
./tools/adni.sh
```

The script:
- finds the newest copies of both files;
- copies them into `data/adni_raw/`, which git ignores, so they are never committed;
- fits every baseline participant and estimates the group templates;
- runs the cross-validated comparison against summary scores;
- shows you the results, then asks before publishing.

If you say yes, it commits only aggregate outputs (`js/adni-fit.js`, `data/adni_fit.json` and the report) and pushes them. GitHub Pages then serves the arcade with ADNI-fitted memory norms and an LMCI-based amnestic template.

If one of the printed ranges looks wrong (for example, recognition false positives in the 10s), the column guess was off. Rerun with a map, for example `./tools/adni.sh ~/Downloads --map fas=AVDELERR1`.

## 4. Keep access current

ADNI requires an annual update. It emails a reminder about a month before your account expires. Any manuscript or public use of results needs the standard ADNI acknowledgment and must follow the ADNI publication policy. Check the policy before presenting the fitted norms publicly.
