// ==UserScript==
// @name         Ganbarometer
// @namespace    http://tampermonkey.net/
// @version      2.1dev
// @description  Add Difficulty, Load, and Speed gauges to the Wanikani Dashboard
// @author       Rex Walters (Rrwrex AKA rw [at] pobox.com)
// @copyright    2021 Rex Robert Walters
// @license      MIT-0 https://opensource.org/licenses/MIT-0
// @include      /^https://(www|preview).wanikani.com/(dashboard)?$/
// @require      https://greasyfork.org/scripts/410909-wanikani-review-cache/code/Wanikani:%20Review%20Cache.js
// @grant        none
// ==/UserScript==

(function (wkof) {
  "use strict";

  // ---------------------- Set up global variables -----------------------

  // This script identifiers for caches, etc.
  const script_id = "ganbarometer";
  const script_name = "GanbarOmeter";

  // Set to true to invoke debugger before exiting script
  // (separate from console logging with settings.debug)
  const useDebugger = false;

  // separate version for the settings themselves
  // update this to erase any user's stored settings and replace with the
  // defaults
  const requiredSettingsVersion = "settings-v2.1dev"; // version settings independently from script

  const defaults = {
    version: requiredSettingsVersion, // track which version populated the settings
    interval: 72, // Number of hours to summarize reviews over
    sessionIntervalMax: 2, // max minutes between reviews in same session
    normalApprenticeQty: 100, // normal number of items in apprentice queue
    newKanjiWeighting: 0.05, // 0.05 => 10 new kanji make it 50% harder
    normalMissPercent: 20, // no additional weighting for up to 20% of daily reviews
    extraMissesWeighting: 0.03, // 0.03 => 10 extra misses make it 30% harder
    maxPace: 300, // maximum number of reviews per day in load graph (50% is normal)
    backgroundColor: "#f4f4f4", // section background color
    debug: false,
  };

  // The metrics we want to retrieve and display
  /*
   *  Metrics: Everything we want to retrieve, compute, or display
   *  -- This is the most important object in the script
   */

  // Initialize the metrics object
  const metrics = {
    reviewed: 0, // total number of items reviewed over interval
    sessions: [], // array of Session objects
    apprentice: 0, // total number of items currently in Apprentice (stages 1-4)
    newKanji: 0, // total number of radicals & kanji in stages 1 or 2
    pareto: [
      // buckets every 15 seconds up to 2 minutes,
      // a bucket for 2 to 10 minutes, then a bucket for everything > 10 min
      // name, rangeStart in seconds, count
      { name: `10"`, rangeStart: 0, count: 0 }, // 0 to 10 seconds
      { name: `20"`, rangeStart: 10, count: 0 }, // 10 to 20 seconds
      { name: `30"`, rangeStart: 20, count: 0 }, // 20 to 30 seconds
      { name: `1'`, rangeStart: 30, count: 0 }, // 30 to 1 min
      { name: `1'30"`, rangeStart: 60, count: 0 }, // 1' to 1'30"
      { name: `2'`, rangeStart: 90, count: 0 }, // 1'30" to 2'
      { name: `5'`, rangeStart: 120, count: 0 }, // 2' to 5'
      { name: `10'`, rangeStart: 300, count: 0 }, // 5' to 10'
      { name: `&gt;10'`, rangeStart: 600, count: 0 }, // > 10 min
    ],

    maxParetoValue: function () {
      return Math.max.apply(
        Math,
        this.pareto.map(function (o) {
          return o.count;
        })
      );
    },

    // total number of minutes spent reviewing over interval
    minutes: function () {
      let min = 0;
      for (let sess of this.sessions) {
        min += sess.minutes();
      }
      return min;
    },

    // Total review period from start of first session
    // to end of last session (in days)
    reviewDays: function () {
      if (this.sessions.length > 0) {
        let start = this.sessions[0].startTime;
        let end = this.sessions[this.sessions.length - 1].endTime;
        return Math.round((end - start) / (1000 * 60 * 60 * 24));
      } else {
        return 0;
      }
    },

    // Total number of misses across all sessions
    totalMisses: function () {
      return this.sessions.reduce(function (prev, cur) {
        return prev + cur.misses;
      }, 0);
    },

    // avg number of incorrect reviews per day (over settings.interval)
    missesPerDay: function () {
      if (this.reviewDays() < 1) {
        // less than one day of reviews
        return this.totalMisses();
      } else {
        return Math.round(this.totalMisses() / (settings.interval / 24));
      }
    },

    // allowed (unweighted) number of misses per day
    allowedMissesPerDay: function () {
      return Math.round(
        this.reviewsPerDay() * (settings.normalMissPercent / 100)
      );
    },

    // misses above those allowed per day (for weighting)
    extraMissesPerDay: function () {
      return this.missesPerDay() - this.allowedMissesPerDay();
    },

    // reviews-per-day averaged over the interval
    reviewsPerDay: function () {
      if (this.reviewDays() < 1) {
        // Less than one day of reviews
        return this.reviewed;
      } else {
        return Math.round(this.reviewed / (settings.interval / 24));
      }
    },

    // seconds-per-review averaged over the sessions
    secondsPerReview: function () {
      return Math.round((60 * this.minutes()) / this.reviewed);
    },

    // difficulty() returns a value from 0 to 1, with 0.5 representing "normal"
    // Normal = ~100 items in Apprentice bucket (stages 1-4)
    difficulty: function () {
      let raw = this.apprentice / (2 * settings.normalApprenticeQty);

      // Heuristic 1: new kanji are harder than other apprentice items
      // raw +=
      //   (this.newKanji * settings.newKanjiWeighting) /
      //   (2 * settings.normalApprenticeQty);
      raw = raw * (1 + this.newKanji * settings.newKanjiWeighting);

      // Heuristic 2: missed items are harder than other apprentice items
      if (this.extraMissesPerDay() > 0) {
        raw =
          raw * (1 + this.extraMissesPerDay() * settings.extraMissesWeighting);
      }

      return raw > 1 ? 1 : raw;
    },

    // pace() returns a value betweeen 0 and 1 representing the percentage of reviews
    // per day relative to maxPace
    pace: function () {
      let raw = this.reviewsPerDay() / settings.maxPace;
      return raw > 1 ? 1 : raw;
    },
  };

  // To be populated by updateGauges()
  let settings = {};
  const settingsConfig = {
    script_id: script_id,
    title: script_name,
    on_save: updateGauges,
    content: {
      interval: {
        type: "number",
        label: "Review history hours",
        default: defaults.interval,
        hover_tip: "Number of hours to summarize reviews over (1 - 168)",
        validate: validateInterval,
      },
      sessionIntervalMax: {
        type: "number",
        label: "Session interval",
        default: defaults.sessionIntervalMax,
        hover_tip: "Max minutes between reviews in a single session (0.5 - 10)",
        min: 1,
        max: 10,
      },
      normalApprenticeQty: {
        type: "number",
        label: "Desired apprentice quantity",
        default: defaults.normalApprenticeQty,
        hover_tip:
          "Number of desired items in the Apprentice bucket (30 - 500)",
        min: 30,
        max: 500,
      },
      newKanjiWeighting: {
        type: "number",
        label: "New kanji weighting factor",
        default: defaults.newKanjiWeighting,
        hover_tip:
          "A value of 0.05 means 10 kanji in stages 1 & 2 imply 50% higher difficulty (0 - 0.1)",
        min: 0,
        max: 0.1,
      },
      normalMissPercent: {
        type: "number",
        label: "Typical percentage of items missed during reviews",
        default: defaults.normalMissPercent,
        hover_tip:
          "Only misses beyond this percentage are weighted more heavily (0 - 50)",
        min: 0,
        max: 50,
      },
      extraMissesWeighting: {
        type: "number",
        label: "Extra misses weighting",
        default: defaults.extraMissesWeighting,
        hover_tip:
          "A value of 0.03 means 10 extra misses imply 30% higher difficulty (0 - 0.1)",
        min: 0,
        max: 0.1,
      },
      maxPace: {
        type: "number",
        label: "Maximum reviews per day",
        default: defaults.maxPace,
        hover_tip:
          "This should be 2X the typical number of reviews/day (10 - 500)",
        min: 10,
        max: 500,
      },
      backgroundColor: {
        type: "color",
        label: "Background color",
        default: defaults.backgroundColor,
        hover_tip: "Background color for theming",
      },
      debug: {
        type: "checkbox",
        label: "Debug",
        default: defaults.debug,
        hover_tip: "Display debug info on console?",
      },
      version: {
        type: "input",
        subtype: "hidden",
        label: "",
        default: defaults.version,
      },
    },
  };

  // ----------------------------------------------------------------------

  // ------------- Begin main execution sequence --------------------------

  // First load the styling
  loadCSS();

  // then add section and populate gauges with dummy data
  insertGbSection();

  // Ensure WKOF is installed
  if (!wkof) {
    let response = confirm(
      `${script_name} requires WaniKani Open Framework.
Click "OK" to be forwarded to installation instructions.`
    );
    if (response) {
      window.location.href =
        "https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549";
      return;
    }
  }

  // Wait until modules are ready then initiate script
  wkof.include("ItemData, Apiv2, Menu, Settings");
  wkof
    .ready("ItemData, Apiv2, Menu, Settings")
    .then(loadSettings)
    .then(updateGauges)
    .then(installMenu)
    .then(debugLog);

  // ------------ End of main excecution sequence -------------------------
  // ------------ Begin supporting functions ------------------------------

  function validateInterval(value, config) {
    if (value >= 24 && value % 24 == 0) {
      return true;
    } else if (value < 24 && value > 1) {
      return true;
    } else {
      return "Interval must be between 1-24 or a multiple of 24 hours";
    }
  }

  function debugLog() {
    // Optionally log what we've extracted
    if (settings.debug) {
      logMetrics(metrics);
    }
    if (useDebugger) {
      debugger;
    }
  }

  // Install our link under [Settings -> script_name ]
  function installMenu() {
    wkof.Menu.insert_script_link({
      name: script_name,
      submenu: "Settings",
      title: script_name,
      on_click: openSettings,
    });
  }

  function openSettings() {
    let dialog = new wkof.Settings(settingsConfig);
    dialog.open();
  }

  function loadSettings() {
    return wkof.Settings.load(script_id, defaults);
  }

  function resetMetrics() {
    metrics.reviewed = 0;
    metrics.sessions = [];
    metrics.apprentice = 0;
    metrics.newKanji = 0;
    metrics.pareto = [
      // buckets every 15 seconds up to 2 minutes,
      // a bucket for 2 to 10 minutes, then a bucket for everything > 10 min
      // name, rangeStart in seconds, count
      { name: `10"`, rangeStart: 0, count: 0 }, // 0 to 10 seconds
      { name: `20"`, rangeStart: 10, count: 0 }, // 10 to 20 seconds
      { name: `30"`, rangeStart: 20, count: 0 }, // 20 to 30 seconds
      { name: `1'`, rangeStart: 30, count: 0 }, // 30 to 1 min
      { name: `1'30"`, rangeStart: 60, count: 0 }, // 1' to 1'30"
      { name: `2'`, rangeStart: 90, count: 0 }, // 1'30" to 2'
      { name: `5'`, rangeStart: 120, count: 0 }, // 2' to 5'
      { name: `10'`, rangeStart: 300, count: 0 }, // 5' to 10'
      { name: `&gt;10'`, rangeStart: 600, count: 0 }, // > 10 min
    ];
  }

  // Update the displayed gauges with current metrics
  async function updateGauges(loadedSettings) {
    // updateGauges will be executed whenever settings change, etc.
    // Ensure metrics are cleared before continuing.
    resetMetrics();

    if (
      typeof loadedSettings.version == "undefined" ||
      loadedSettings.version != requiredSettingsVersion
    ) {
      // Required settings version not found, force save of defaults
      alert(
        `User's Ganbarometer settings overwritten with defaults (${requiredSettingsVersion} not found)`
      );

      // overwrite user's stored settings
      wkof.settings.ganbarometer = defaults;
      wkof.Settings.save("ganbarometer");

      // use defaults in this session
      settings = defaults;
    } else {
      // already loaded settings with the required version
      settings = loadedSettings;
    }

    // new settings, so refresh the content
    loadCSS();
    let gbSection = document.querySelector(`.${script_id}`);
    if (gbSection != null) {
      // already rendered, so repopulate
      await collectMetrics();
      populateGbSection(document.querySelector(`.${script_id}`));
    }
  }

  function loadCSS() {
    let css = `
    .${script_id} * {
      box-sizing: border-box;
    }
    
    .${script_id} {
      display:flex;
      justify-content: space-around;
      background-color: ${
        settings.backgroundColor
          ? settings.backgroundColor
          : defaults.backgroundColor
      };
      border-radius: 5px;
      overflow: hidden;
      flex-wrap: wrap;
    }
    
    .${script_id} h1 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      text-align: center;
      display: inline-block;
      width: 70%;
    }
    
    .${script_id} p {
      font-size: 10px;
      margin: 0;
    }
    
    .${script_id} label {
      margin: 0;
      text-align: center;
      width: 100%;
      font-size: 12px;
      line-height: 16px;
      color: #bbb;
    }
    
    .gauge {
      width: 100%;
      min-width: 120px;
      max-width: 150px;
      height: 125px;
      padding: 0 10px;
      color: #004033;
      display: flex;
      flex-direction: column;
      align-items: center;
      background-color: ${
        settings.backgroundColor
          ? settings.backgroundColor
          : defaults.backgroundColor
      };
    }
    
    .gauge__body {
      width: 100%;
      height: 0;
      padding-bottom: 50%;
      background: #b4c0be;
      position: relative;
      border-top-left-radius: 100% 200%;
      border-top-right-radius: 100% 200%;
      overflow: hidden;
    }
    
    .gauge__fill {
      position: absolute;
      top: 100%;
      left: 0;
      width: inherit;
      height: 100%;
      background: #59c273;
      transform-origin: center top;
      transform: rotate(0.25turn);
      transition: transform 0.2s ease-out;
    }
    
    .gauge__cover {
      width: 75%;
      height: 150%;
      background-color: ${
        settings.backgroundColor
          ? settings.backgroundColor
          : defaults.backgroundColor
      };
      border-radius: 50%;
      position: absolute;
      top: 25%;
      left: 50%;
      transform: translateX(-50%);
    
      /* Text */
      display: flex;
      align-items: center;
      justify-content: center;
      padding-bottom: 25%;
      box-sizing: border-box;
      font-size: 25px;
    }
    
    #gbSpeed {
      position: relative;
      height: 125px;
    }
    
    #gbSpeed h2 {
      font-size: 12px;
      display: inline-block;
      width: 30%;
      text-align: center;
      margin: 0;
    }
    
    #gbSpeed .chart {
      display: grid;
      grid-template-columns: repeat(${metrics.pareto.length}, 1fr);
      grid-template-rows: repeat(100, 1fr);
      grid-column-gap: 2px;
      height: 65px;
      min-width: 240px;
      width: 15%;
      padding: 5px;
      background: ${
        settings.backgroundColor
          ? settings.backgroundColor
          : defaults.backgroundColor
      };
    }
    
    #gbSpeed .bar {
      border-radius: 0;
      transition: all 0.6s ease;
      background-color: #59c273;
      grid-row-start: 1;
      box-sizing: border-box;
      grid-row-end: 101;
      text-align: center;
      margin-top: auto;
    }
    
    #gbSpeed .bar span {
      position: relative;
      top: -20px;
      font-size: 10px;
    }
    
    #gbSpeed .bar label {
      position: absolute;
      bottom: -23px;
      font-size: 10px;
      margin: 0;
      padding: 0;
      text-align: center;
    }
    
    `;

    // Remove the style if already present
    if (
      typeof document.getElementsByTagName("style").ganbarometer !== "undefined"
    ) {
      document.getElementsByTagName("style").ganbarometer.remove;
    }

    const gbStyle = document.createElement("style");
    gbStyle.id = script_id;
    gbStyle.innerHTML = css;
    document.querySelector("head").append(gbStyle);
  }

  // Retrieve reviews from API and calculate metrics
  async function collectMetrics() {
    // Get all reviews within interval hours of now
    let firstReviewDate = new Date(
      Date.now() - settings.interval * 60 * 60 * 1000
    );
    let options = {
      last_update: firstReviewDate,
    };

    let reviewCollection = await wkof.Apiv2.fetch_endpoint("reviews", options);
    let reviews = reviewCollection.data;

    // Save our first metric
    metrics.reviewed = reviews.length;

    // Calculate and save our second set of metrics
    // findSessions() returns an Array of Session objects
    // Also builds metrics.pareto
    metrics.sessions = findSessions(reviews);

    // Retrieve and save the apprentice metrics
    let config = {
      wk_items: {
        filters: {
          srs: "appr1, appr2, appr3, appr4",
        },
      },
    };

    let items = await wkof.ItemData.get_items(config);

    metrics.apprentice = items.length;

    // Finally, retrieve and save the number of kanji in stages 1 and 2
    config = {
      wk_items: {
        filters: {
          srs: "appr1, appr2",
          item_type: "kan",
        },
      },
    };
    items = await wkof.ItemData.get_items(config);
    metrics.newKanji = items.length;
  }

  function logMetrics(metrics) {
    console.log(
      `------ GanbarOmeter debug output ------

Local time: ${Date()}

settings:
  - interval: ${settings.interval}
  - sessionIntervalMax: ${settings.sessionIntervalMax}
  - normalApprenticeQty: ${settings.normalApprenticeQty}
  - newKanjiWeighting: ${settings.newKanjiWeighting}
  - normalMissPercent: ${settings.normalMissPercent}
  - extraMissesWeighting: ${settings.extraMissesWeighting}
  - maxPace: ${settings.maxPace}
  - backgroundColor: ${settings.backgroundColor}

${metrics.reviewed} reviews in ${settings.interval} hours
${Math.round(10 * metrics.missesPerDay()) / 10} misses per day on average
${metrics.minutes()} total minutes
${Math.round(1000 * metrics.reviewDays()) / 1000} review days
${metrics.sessions.length} sessions:`
    );

    let lastEndTime = 0;
    metrics.sessions.forEach((s) => {
      console.log(
        `     - (${
          lastEndTime > 0
            ? Math.round((s.startTime - lastEndTime) / (1000 * 60))
            : "?"
        } minutes since prior)
       Start: ${s.startTime}
       End: ${s.endTime}
       Misses: ${s.misses}
       Reviews: ${s.len}
       Review minutes: ${s.minutes()}`
      );
      lastEndTime = s.endTime;
    });

    console.log(
      `${metrics.apprentice} apprentice ${metrics.newKanji} newKanji`
    );

    console.log(
      `${metrics.reviewsPerDay()} reviews per day (0 - ${settings.maxPace})`
    );

    console.log(`${metrics.secondsPerReview()} seconds per review settings`);

    console.log(
      `Difficulty: ${Math.round(1000 * metrics.difficulty()) / 1000} (0-1)`
    );
    console.log(`Pace: ${metrics.pace()}`);
    console.log(
      `Review-to-review intervals (average: ${metrics.secondsPerReview()}s):`
    );
    metrics.pareto.forEach((bucket) => {
      console.log(`  ${bucket.name}: ${bucket.count}`);
    });
    console.log(`------ End GanbarOmeter ------`);
  }

  // Create an html <section> for our metrics and add to dashboard
  function insertGbSection() {
    let section = document.createElement("Section");
    section.classList.add(`${script_id}`);
    populateGbSection(section);
    // Now add our new section at the just before the forum list
    document.querySelector(".progress-and-forecast").before(section);

    return section;
  }

  function populateGbSection(gbSection) {
    // display in bold count of kanji in stages 1 & 2
    // because they are weighted
    let kanjiWeightLabel =
      metrics.newKanji > 0 ? `<strong>${metrics.newKanji}</strong>k, ` : "";

    // display any extra misses in bold because they are weighted
    // if misses < allowed percentage, then just show the count (in normal font)
    let missLabel = "";
    if (metrics.extraMissesPerDay() > 0) {
      missLabel += `${metrics.allowedMissesPerDay()}+<strong>${metrics.extraMissesPerDay()}</strong>m`;
    } else {
      missLabel += `${Math.round(metrics.missesPerDay())}m`;
    }

    // Difficulty label shows count of Apprentice items plus any weighting
    let diffLabel = `${metrics.apprentice}A (${kanjiWeightLabel}${missLabel})`;

    // Pace label shows reviews/day and number of sessions
    let paceLabel = `${metrics.sessions.length} sessions, ${metrics.reviewed} reviews`;

    gbSection.innerHTML =
      renderGaugeDiv("gbDifficulty", "Difficulty", diffLabel) +
      renderGaugeDiv("gbLoad", "Reviews/day", paceLabel);

    let gauge = gbSection.querySelector("#gbDifficulty");
    setGaugeValue(gauge, metrics.difficulty());

    gauge = gbSection.querySelector("#gbLoad");
    setGaugeValue(gauge, metrics.pace(), `${metrics.reviewsPerDay()}`);

    // Now add the divs for the speed bar chart
    let barsContainer = document.createElement("div");
    // barsContainer.classList.add("gbSpeed");
    barsContainer.id = "gbSpeed";
    barsContainer.innerHTML = `<h1>Review Intervals</h1><h2>Average: ${metrics.secondsPerReview()}s</h2>`;
    let chart = document.createElement("div");
    chart.classList.add("chart");
    barsContainer.appendChild(chart);

    for (let i = 0; i < metrics.pareto.length; i++) {
      let metric = metrics.pareto[i];
      let bar = document.createElement("div");
      bar.classList.add("bar");
      bar.innerHTML = `<span>${metric.count}</span><label>${metric.name}</label>`;
      bar.style.position = "relative";
      bar.style.height = `${100 * (metric.count / metrics.maxParetoValue())}%`;
      chart.appendChild(bar);
    }

    // add the bars to the end
    gbSection.append(barsContainer);

    // Add label to the end of the section
    let label = document.createElement("label");
    label.innerHTML = settings.interval
      ? `<label>Daily averages for the past ${settings.interval} hours</label>`
      : `<label><strong>LOADING REVIEW DATA FROM WANIKANI API&hellip;</strong></label>`;
    gbSection.append(label);

    return gbSection;
  }

  function renderGaugeDiv(id, title, text) {
    return `<div id="${id}" class="gauge">
    <h1>${title}</h1>
    <div class="gauge__body">
      <div class="gauge__fill"></div>
      <div class="gauge__cover"></div>
    </div>
    <p>${text}</p>
  </div>`;
  }

  function setGaugeValue(gauge, value, displayValue) {
    // no values less than 0 or greater than 1
    value = value < 0 ? 0 : value;
    value = value > 1 ? 1 : value;

    // Use displayValue if passed, otherwise just "xx%"
    let display = displayValue ? displayValue : `${Math.round(value * 100)}%`;

    // Rotate the gauge__fill rectangle the appropriate number of degrees
    gauge.querySelector(".gauge__fill").style.transform = `rotate(${
      value / 2
    }turn)`;
    gauge.querySelector(".gauge__cover").textContent = display;

    if (value >= 0.9) {
      // red for > 90%
      gauge.querySelector(".gauge__fill").style.backgroundColor = "#e50036";
    } else if (value >= 0.8) {
      // yellow for > 80%
      gauge.querySelector(".gauge__fill").style.backgroundColor = "#ece619";
    }
  }

  // A Session object holds an index into an array of reviews, plus a length
  // Define a Session object
  class Session {
    constructor(firstIndex, length, startTime, endTime, misses) {
      this.firstIndex = firstIndex; // index of first review in this session
      this.len = length; // number of reviews in this session
      this.startTime = startTime; // start time of first review (Date object)
      this.endTime = endTime; // start(!!) time of final review (Date object)
      this.misses = misses; // "miss" means one or more incorrect answers (reading or meaning)

      // number of minutes spent reviewing in this session
      this.minutes = function () {
        // might be just one review in session or VERY short timespan between
        // start and end, so return 15 seconds for any value less than 15 seconds
        return (this.endTime - this.startTime) / 1000 > 15
          ? Math.round((this.endTime - this.startTime) / (1000 * 60))
          : 15 / 60;
      };
    }
  }

  function findSessions(reviews) {
    // Start with an empty array of sessions
    let sessions = [];
    // Get the time of the first review
    let firstTime =
      reviews.length > 0 ? new Date(reviews[0].data_updated_at) : new Date(0);

    // Initialize what will become sessions[0]
    let curSession = new Session(
      0, // firstIndex - start with reviews[0]
      0, // length (currently unknown, initialize to zero)
      firstTime, // startTime is time of first review
      firstTime, // endTime (currently unknown, initialize to startTime)
      0 // misses (currently unknown, initialize to zero)
    );

    // Now iterate through reviews to find sessions
    // note that reviews[0] is guaranteed to be within the current session!
    reviews.forEach((review) => {
      if (
        withinSession(
          curSession.endTime, // prevTime
          new Date(review.data_updated_at), // newTime
          settings.sessionIntervalMax // maxMinutes
        )
      ) {
        // Still within a session, so increment the length
        curSession.len += 1;

        // "miss" means one or more incorrect meaning or reading answers
        // but the count of incorrect answers doesn't matter: any incorrect
        // answers mean the item was "missed"
        let missCount =
          review.data.incorrect_meaning_answers +
          review.data.incorrect_reading_answers;
        if (missCount > 0) {
          curSession.misses++;
        }

        // Update endTime the the time of this review
        curSession.endTime = new Date(review.data_updated_at);
      } else {
        // Finished prior session and starting a new one
        sessions.push(curSession);
        // And create a new curSession of length 1 for this review
        let newIndex = curSession.firstIndex + curSession.len;
        let newDate = new Date(review.data_updated_at);
        let missCount =
          review.incorrect_meaning_answers +
          review.data.incorrect_reading_answers;
        if (missCount > 0) {
          //                       first,  len, start,   end,     misses
          curSession = new Session(newIndex, 1, newDate, newDate, 1);
        } else {
          curSession = new Session(newIndex, 1, newDate, newDate, 0);
        }
      }
    });
    // Don't forget the last session when we fall out of the loop
    sessions.push(curSession);
    return sessions;
  }

  // Determine if newTime is within maxMinutes of prevTime
  function withinSession(prevTime, newTime, maxMinutes) {
    let timeDifference = newTime - prevTime;

    // increment appropriate pareto counter
    for (let i = metrics.pareto.length - 1; i >= 0; i--) {
      let bucket = metrics.pareto[i];
      if (timeDifference >= bucket.rangeStart * 1000) {
        bucket.count += 1;
        break;
      }
    }
    return timeDifference <= maxMinutes * 1000 * 60;
  }
})(window.wkof);
