# Trust Ladder and human approval

Source: README.md

QUORUM classifies browser actions according to reversibility. The model does not decide
whether an action is allowed.

- L0: read-only actions such as screenshots, scrolling, and extraction.
- L1: navigation such as opening a page or following a link.
- L2: reversible page changes such as typing, selecting, or toggling.
- L3: commits such as submitting a form or sending data; approval is required.
- L4: credentials, payment, or navigation outside the allowed domains; approval is required.

The autonomy setting can change how much friction is applied to reversible actions. It
does not remove the approval gate from irreversible actions. A human can approve, reject,
or take over the run.
