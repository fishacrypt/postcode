# Address module and Nigerian postcodes

## Structure

`packages/address` defines a `CountryModule` interface (states, LGAs, postcode normalisation and format validation) and a registry. Only `NG` is active. Another country is added as a new folder under `packages/address/src/countries/` and one registry entry. Nothing else in the app is Nigeria-specific except the module data and the postcode formats.

Nigeria data: all 36 states and the Federal Capital Territory with ISO 3166-2 codes, and 774 LGAs (unit-tested for the expected per-state counts and totals). The LGA list was written from public knowledge and has **not** been reconciled against an official publication. Before launch, reconcile it with the National Population Commission or INEC list. Renamed or newly created LGAs will need a data update.

## Postcode formats

| Format | Pattern | Source | Confidence |
| --- | --- | --- | --- |
| Legacy six-digit | `^\d{6}$` | NIPOST addressing standard and UPU country sheet | Documented. Postcode +2 (eight digits) is not supported |
| Digital 11-character | two letters, then nine letters or digits, shown as `FC 02 A09 DB 09` | NIPOST page "What is the New Alphanumeric Postcode?" (published 7 October 2026) | **Provisional.** Derived from one published example. The first two characters identify the state or FCT |

NIPOST has not published, in the pages reviewed, the full list of two-character state codes. The only code the module treats as known is `FC` for the Federal Capital Territory. A digital postcode whose prefix disagrees with a chosen FCT or non-FCT state is reported as inconsistent. All other prefixes are "not assessable". No prefix-to-state table was invented.

Third-party directories were found that map six-digit ranges to states. They were not used, because they contradict each other on region digits and are not official.

## Validation layers

Validation reports separate results. A well-formed postcode never looks like a verified one.

1. **Format**: normalised input matches a known format.
2. **Dataset**: `matched`, `not_found`, or `dataset_unavailable`. With no imported dataset the status is `dataset_unavailable`, never `not_found`.
3. **Geographic consistency**: `consistent`, `inconsistent` or `not_assessable`. Uses the dataset record (state and, when present, LGA) and the FCT prefix rule above.
4. **GPS**: `not_provided`, `captured` (a fix inside Nigeria bounds, accuracy 100 m or better, taken within ten minutes of saving) or `unconfirmed`. It is a device location at one moment. It is not compared with a reference location and does not establish legal residence.
5. **Proof of residence**: always `not_established`.

Assurance levels: 0 invalid format; 1 format valid; 2 dataset match with no geographic conflict; 3 level 2 plus a qualifying GPS fix. A credential records its level. Credentials cannot be issued at level 0 or when the dataset contradicts the entered state or LGA.

## Postcode dataset

Coverage today: **none**. No dataset is bundled and nothing is fabricated.

Candidate sources reviewed:

- NIPOST postcode finder (https://nipost.gov.ng/postcode-finder/): authoritative, no bulk export or licence terms found.
- Nigerian National Addressing Standard and Guidelines (NIPOST, 2024): defines the six-digit structure, not a code list.
- OpenNG postal codes API (https://openng-docs.vercel.app/data-api/postal-codes): states NIPOST as primary source with community cross-checks and per-row confidence. It could not be reached from the build sandbox, so it was not evaluated or used.
- Community directories such as zipcodes.ng: unverified, not used.

### Importing a dataset

```bash
bun run postcodes:import ./postcodes.csv --source-id nipost-2026-11 --name "NIPOST postcode directory" \
  --publisher NIPOST --url https://nipost.gov.ng/postcode-finder/ --retrieved 2026-11-17 \
  --licence "<terms you obtained>" --coverage "<what the file covers>" --notes "<limitations>"
```

CSV columns: `postcode,state,lga,area`. Rows are normalised and rejected when the postcode format or state is invalid. Each import records its source (name, publisher, URL, retrieval date, licence, coverage, notes) in `postcode_sources`, and the sources appear at `GET /api/v1/postcodes/dataset`. Do not import data you do not have the right to use.

Known limitations once data is loaded: coverage depends on the file; boundaries change; the lookup is exact-match by normalised postcode.
