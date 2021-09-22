// ==UserScript==
// @name         Ganbarometer
// @namespace    http://tampermonkey.net/
// @version      1.1
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
  const script_name = "Ganbarometer";

  const defaults = {
    version: "settings-v0.1", // track which version populated the settings
    interval: 72, // Number of hours to summarize reviews over
    sessionIntervalMax: 2, // max minutes between reviews in same session
    normalApprenticeQty: 100, // normal number of items in apprentice queue
    newKanjiWeighting: 0.05, // 0.05 => 10 new kanji make it 50% harder
    normalMisses: 20, // no additional weighting for up to 20% of daily reviews
    extraMissesWeighting: 0.03, // 0.03 => 10 extra misses make it 30% harder
    maxLoad: 300, // maximum number of reviews per day in load graph (50% is normal)
    maxSpeed: 30, // maximum number of seconds per review in speed graph (50% is normal)
    backgroundColor: "#f4f4f4", // section background color
  };

  // The metrics we want to retrieve and display
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

    // avg number of review items answered incorrectly per day
    missesPerDay: function () {
      let s = 0;
      for (let sess of this.sessions) {
        s += sess.misses;
      }
      s = (s * 24) / settings.interval;
      return s;
    },

    // reviews-per-day averaged over the interval
    reviewsPerDay: function () {
      return Math.round((this.reviewed * 24) / settings.interval);
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
      let allowedMisses = Math.round(
        settings.normalMisses * this.reviewsPerDay
      );
      let extraMisses = this.missesPerDay - allowedMisses;
      if (extraMisses > 0) {
        raw = raw * (1 + extraMisses * settings.extraMissesWeighting);
      }

      return raw > 1 ? 1 : raw;
    },

    // load() returns a value betweeen 0 and 1 representing the percentage of reviews
    // per day relative to maxLoad
    load: function () {
      let raw = this.reviewsPerDay() / settings.maxLoad;
      return raw > 1 ? 1 : raw;
    },

    // speed() returns a value between 0 and 1 representing the percentage of seconds
    // per review relative to maxSpeed
    speed: function () {
      let raw = this.secondsPerReview() / settings.maxSpeed;
      return raw > 1 ? 1 : raw;
    },
  };

  // To be populated by updateSettings()
  const requiredSettingsVersion = "settings-v0.1"; // Only update when user's saved settings must be overwritten
  let settings = {};

  const settingsConfig = {
    script_id: script_id,
    title: script_name,
    on_save: updateSettings,
    content: {
      interval: {
        type: "number",
        label: "Review history hours",
        default: defaults.interval,
        hover_tip: "Number of hours to summarize reviews over (1 - 168)",
        min: 1,
        max: 168,
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
      normalMisses: {
        type: "number",
        label: "Typical percentage of items missed during reviews",
        default: defaults.normalMisses,
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
      maxLoad: {
        type: "number",
        label: "Maximum reviews per day",
        default: defaults.maxLoad,
        hover_tip:
          "This should be 2X the typical number of reviews/day (10 - 500)",
        min: 10,
        max: 500,
      },
      maxSpeed: {
        type: "number",
        label: "Maximum number of seconds per review",
        default: defaults.maxSpeed,
        hover_tip:
          "This should be 2x the typical number of seconds/review (10 - 60)",
        min: 10,
        max: 60,
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
    },
  };

  // ----------------------------------------------------------------------

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
    .then(updateSettings)
    .then(installMenu)
    .then(loadCSS)
    .then(render);

  // Install our link under [Scripts -> Demo -> Settings Demo]
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

  async function updateSettings(loadedSettings) {
    if (
      typeof loadedSettings.version == "undefined" ||
      loadedSettings.version != requiredSettingsVersion
    ) {
      // Required settings version not found, force save of defaults
      alert(
        `User's Ganbarometer settings overwritten with defaults (${requiredSettingsVersion} not found)`
      );

      // overwrite user's stored settings
      loadedSettings = defaults;
      wkof.Settings.save("ganbarometer");

      // use defaults in this session
      settings = defaults;
    } else {
      // already loaded settings with the required version
      settings = loadedSettings;
    }

    // new settings, so refresh the content
    let gbSection = document.querySelector(`.${script_id}`);
    if (gbSection != null) {
      // already rendered, so repopulate
      await collectMetrics();
      populateGbSection(document.querySelector(`.${script_id}`));
    }
  }

  let css = "";

  function loadCSS() {
    css = `
.${script_id} {
  display:flex;
  justify-content: space-around;
  background-color: ${settings.backgroundColor};
  border-radius: 5px;
  overflow: hidden;
  flex-wrap: wrap;
}

.${script_id} h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  text-align: center;
}

.${script_id} p {
  font-size: 10px;
  margin: 0;
}

.${script_id} label {
  margin: 0;
  text-align: center;
  width: 100%;
  padding: 0 10px;
  font-size: 12px;
  color: #bbb;
}

.gauge {
  width: 100%;
  min-width: 120px;
  max-width: 150px;
  padding: 0 10px;
  color: #004033;
  display: flex;
  flex-direction: column;
  align-items: center;
  background-color: ${settings.backgroundColor};
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
  background-color: ${settings.backgroundColor};
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

#gbSpeed .chart {
  display: grid;
  grid-template-columns: repeat(${metrics.pareto.length}, 1fr);
  grid-template-rows: repeat(100, 1fr);
  grid-column-gap: 2px;
  height: 70px;
  min-width: 300px;
  width: 15%;
  background: ${settings.backgroundColor};
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
  /*width: auto;*/
  bottom: -23px;
  font-size: 10px;
  margin: 0;
  padding: 0;
  text-align: center;
}

    `;

    const gbStyle = document.createElement("style");
    gbStyle.id = script_id;
    gbStyle.innerHTML = css;
    document.querySelector("head").append(gbStyle);
  }

  /*
   * ********* MAIN function to calculate and display metrics ********
   */

  async function collectMetrics() {
    // Get all reviews within interval hours of now
    let firstReviewDate = new Date(
      Date.now() - settings.interval * 60 * 60 * 1000
    );
    let options = {
      last_update: firstReviewDate,
    };

    let reviewCollection = await wkof.Apiv2.fetch_endpoint("reviews", options);
    let newReviews = reviewCollection.data;

    // Save our first metric
    metrics.reviewed = newReviews.length;

    // Calculate and save our second set of metrics
    // findSessions() returns an Array of Session objects
    // Also builds metrics.pareto
    metrics.sessions = findSessions(newReviews);

    // Finally, retrieve and save the apprentice and newKanji metrics
    let config = {
      wk_items: {
        filters: {
          srs: "appr1, appr2, appr3, appr4",
        },
      },
    };
    let items = await wkof.ItemData.get_items(config);
    metrics.apprentice = items.length;
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

    // Optionally log what we've extracted
    if (settings.debug) {
      logMetrics(metrics);
    }
  }

  async function render() {
    await collectMetrics();
    // Now populate the section and add it to the dashboard
    insertGbSection();
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
  - normalMisses: ${settings.normalMisses}
  - extraMissesWeighting: ${settings.extraMissesWeighting}
  - maxLoad: ${settings.maxLoad}
  - maxSpeed: ${settings.maxSpeed}
  - backgroundColor: ${settings.backgroundColor}

${metrics.reviewed} reviews in ${settings.interval} hours
${Math.round(10 * metrics.missesPerDay()) / 10} misses per day
${metrics.minutes()} total minutes
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

    console.log("Pareto of review-to-review intervals:");
    metrics.pareto.forEach((bucket) => {
      console.log(`  ${bucket.name}: ${bucket.count}`);
    });

    console.log(
      `${metrics.apprentice} apprentice ${metrics.newKanji} newKanji`
    );

    console.log(
      `${metrics.reviewsPerDay()} reviews per day (0 - ${settings.maxLoad}`
    );

    console.log(
      `${metrics.secondsPerReview()} seconds per review (0 - ${
        settings.maxSpeed
      })`
    );

    console.log(`Difficulty: ${metrics.difficulty()} (0-1)`);
    console.log(`Load: ${metrics.load()}`);
    console.log(`Speed: ${metrics.speed()}`);
    console.log(`------ End GanbarOmeter ------`);
  }

  function createGbSection() {
    // Create a section for our content
    const gbSection = document.createElement("Section");
    gbSection.classList.add(`${script_id}`);
    return gbSection;
  }

  function populateGbSection(gbSection) {
    let html =
      `<label>Daily averages for the past ${settings.interval} hours</label>` +
      renderGaugeDiv(
        "gbDifficulty",
        "Difficulty",
        `${metrics.apprentice} (${metrics.newKanji}k/${Math.round(
          metrics.missesPerDay()
        )}m)`
      ) +
      renderGaugeDiv("gbLoad", "Pace", "reviews/day");

    gbSection.innerHTML = html;

    let gauge = gbSection.querySelector("#gbDifficulty");
    setGaugeValue(gauge, metrics.difficulty());

    gauge = gbSection.querySelector("#gbLoad");
    setGaugeValue(gauge, metrics.load(), `${metrics.reviewsPerDay()}`);

    // Now add the divs for the speed bar chart
    let barsContainer = document.createElement("div");
    // barsContainer.classList.add("gbSpeed");
    barsContainer.id = "gbSpeed";
    barsContainer.innerHTML = "<h1>Answer Speed</h1>";
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

    gbSection.append(barsContainer);

    /* 
    gauge = gbSection.querySelector("#gbSpeed");
    setGaugeValue(gauge, metrics.speed(), `${metrics.secondsPerReview()}`);
    */
  }

  // Create an html <section> for our metrics and add to dashboard
  function insertGbSection(section) {
    section = createGbSection();
    populateGbSection(section);
    // Now add our new section at the just before the forum list
    document.querySelector(".progress-and-forecast").before(section);
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

    let display = displayValue ? displayValue : `${Math.round(value * 100)}%`;

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

  // Function to return a filtered array of reviews
  // older than the specified number of hours
  function filterRecent(reviews, hours) {
    return reviews.filter(
      // a[0] = creationDate
      (a) => a[0] > Date.now() - hours * 60 * 60 * 1000
    );
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
      this.minutes = function () {
        // number of minutes spent reviewing in this session
        let raw =
          endTime - startTime < settings.maxSpeed * 100
            ? Math.round((this.endTime - this.startTime) / (1000 * 60))
            : settings.maxSpeed / 2; // assume single review session speed is typical
        return raw;
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
        curSession.misses +=
          review.data.incorrect_meaning_answers +
            review.data.incorrect_reading_answers >
          0
            ? 1
            : 0;
        // Update endTime the the time of this review
        curSession.endTime = new Date(review.data_updated_at);
      } else {
        // Finished prior session and starting a new one
        sessions.push(curSession);
        // And create a new curSession of length 1 for this review
        let newIndex = curSession.firstIndex + curSession.len;
        let newDate = new Date(review.data_updated_at);
        let curMisses =
          review.incorrect_meaning_answers +
            review.data.incorrect_reading_answers >
          0
            ? 1
            : 0;
        curSession = new Session(newIndex, 1, newDate, newDate, curMisses);
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
