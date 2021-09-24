# Changelog

- v2.0 Two gauges and a chart walk into a bar

  - Released ??/??/??
  - Uses a "pareto" (-ish) chart to display review-interval breakdown (instead of a gauge
    for average seconds per review).
  - Settings changes no longer require a manual refresh of the page.
  - Displays gauges immediately, then updates values when WK API call returns
  - Custom validator for Interval (must be between 1-24, or a multiple of 24 hours)
  - Fixes bug if less than full day of reviews retrieved (`interval` &lt; 24
    hours)
  - renamed "load" to "pace"
  - versioning of settings (allows invalidation of stored settings with new
    script versions)
  - layout tweaks and cleanup

- v1.0 First usable release

  - Released Monday, 9/20/2021.
  - Fixes a silly but major bug with Speed gauge (now interprets `Session interval` in minutes, not hours).
  - Uses WKOF Settings dialog for user settings (with input validation).
  - Adds more info to debug log including inter-session intervals, and pareto
    of inter-review intervals.
  - Attempts to handle Date objects correctly.
  - Displays misses/day as well as new kanji count
    in difficulty gauge.

- v0.1 Initial alpha release

  Released around midnight on Friday, 9/17/2021
