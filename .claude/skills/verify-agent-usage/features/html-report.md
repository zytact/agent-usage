# HTML report

## Sub-features

- Explicit output file through `--html FILE`
- HTML on stdout through `--html=-`
- Browser opening when `--html` has no file
- Summary, Full mode, and selected-Section rendering

## How to get to it (user POV)

Add `--html FILE` to write a standalone HTML report. Use `--html=-` for stdout, or omit the file to let Agent Usage choose a temporary file and open it.

## Driving it with drive.sh

Run `scripts/drive.sh html-report`. The action records the terminal confirmation and `report.html`. The HTML file must contain the `Agent usage` heading, `Source share`, and `Codex`, with no empty-range notice.

## Gotchas

The HTML report is the file side effect and part of the proof. A successful exit or terminal path alone does not prove it rendered. The report is standalone and should not request network resources.
