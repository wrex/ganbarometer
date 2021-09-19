// ==UserScript==
// @name         Ganbarometer
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Add Pace and Difficulty gauges to the Wanikani Dashboard
// @author       Rex Walters (Rrwrex AKA rw [at] pobox.com)
// @copyright    2021 Rex Robert Walters
// @license      MIT-0 https://opensource.org/licenses/MIT-0
// @include      /^https://(www|preview).wanikani.com/(dashboard)?$/
// @require      https://greasyfork.org/scripts/410909-wanikani-review-cache/code/Wanikani:%20Review%20Cache.js
// @grant        none
// ==/UserScript==

(function (wkof) {
  "use strict";

  // This script identifiers for caches, etc.
  const script_id = "ganbarometer";
  const script_name = "Ganbarometer";

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
      title: "GanbarOmeter",
      on_click: openSettings,
    });
  }

  const settings = {};

  let defaults = {
    debug: true, // display debug information
    interval: 72, // Number of hours to summarize reviews over
    sessionIntervalMax: 10, // max minutes between reviews in same session
    normalApprenticeQty: 100, // normal number of items in apprentice queue
    newKanjiWeighting: 0.05, // 0.05 => 10 new kanji make it 50% harder
    normalMisses: 20, // no additional weighting for up to 20% of daily reviews
    extraMissesWeighting: 0.03, // 0.03 => 10 extra misses make it 30% harder
    maxLoad: 300, // maximum number of reviews per day in load graph (50% is normal)
    maxSpeed: 30, // maximum number of seconds per review in speed graph (50% is normal)
    backgroundColor: "#f4f4f4", // section background color
  };

  function loadSettings() {
    return wkof.Settings.load(script_id, defaults);
  }

  function openSettings() {
    let config = {
      script_id: script_id,
      title: script_name,
      on_save: updateSettings,
      content: {
        interval: {
          type: "number",
          label: "Running Average Hours",
          default: defaults.interval,
          hover_tip: "Number of hours to summarize reviews over",
        },
        sessionIntervalMax: {
          type: "number",
          label: "Session interval",
          default: defaults.sessionIntervalMax,
          hover_tip: "Max minutes between reviews in a single session",
        },
        normalApprenticeQty: {
          type: "number",
          label: "Desired apprentice quantity",
          default: defaults.normalApprenticeQty,
          hover_tip: "Number of desired items in the Apprentice bucket",
        },
        newKanjiWeighting: {
          type: "number",
          label: "New kanji weighting factor",
          default: defaults.newKanjiWeighting,
          hover_tip:
            "A value of 0.05 means 10 kanji in stages 1 & 2 imply 50% higher difficulty",
        },
        normalMisses: {
          type: "number",
          label: "Typical percentage of items missed during reviews",
          default: defaults.normalMisses,
          hover_tip:
            "Only misses beyond this percentage are weighted more heavily",
        },
        extraMissesWeighting: {
          type: "number",
          label: "Extra misses weighting",
          default: defaults.extraMissesWeighting,
          hover_tip:
            "A value of 0.03 means extra misses imply 30% higher difficulty",
        },
        maxLoad: {
          type: "number",
          label: "Maximum reviews per day",
          default: defaults.maxLoad,
          hover_tip: "This should be 2X the typical number of reviews/day",
        },
        maxSpeed: {
          type: "number",
          label: "Maximum number of seconds per review",
          default: defaults.maxSpeed,
          hover_tip: "This should be 2x the typical number of seconds/review",
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
    let dialog = new wkof.Settings(config);
    dialog.open();
  }

  function updateSettings() {
    settings.debug = wkof.settings.ganbarometer.debug;
    settings.interval = wkof.settings.ganbarometer.interval;
    settings.sessionIntervalMax = wkof.settings.ganbarometer.sessionIntervalMax;
    settings.normalApprenticeQty =
      wkof.settings.ganbarometer.normalApprenticeQty;
    settings.newKanjiWeighting = wkof.settings.ganbarometer.newKanjiWeighting;
    settings.normalMisses = wkof.settings.ganbarometer.normalMisses / 100;
    settings.extraMissesWeighting =
      wkof.settings.ganbarometer.extraMissesWeighting;
    settings.maxLoad = wkof.settings.ganbarometer.maxLoad;
    settings.maxSpeed = wkof.settings.ganbarometer.maxSpeed;
    settings.backgroundColor = wkof.settings.ganbarometer.backgroundColor;
    wkof.Settings.save(script_id);
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
    `;
  }

  // The metrics we want to retrieve and display
  const metrics = {
    reviewed: 0, // total number of items reviewed over interval
    sessions: [], // array of Session objects
    apprentice: 0, // total number of items currently in Apprentice (stages 1-4)
    newKanji: 0, // total number of radicals & kanji in stages 1 or 2
    minutes: function () {
      // total number of minutes spent reviewing over interval
      let min = 0;
      for (let sess of this.sessions) {
        min += sess.minutes();
      }
      return min;
    },
    missesPerDay: function () {
      // number of review items answered incorrectly over interval
      let s = 0;
      for (let sess of this.sessions) {
        s += sess.misses;
      }
      s = (s * 24) / settings.interval;
      return s;
    },
    reviewsPerDay: function () {
      // reviews-per-day averaged over the interval
      return Math.round((this.reviewed * 24) / settings.interval);
    },
    secondsPerReview: function () {
      // seconds-per-review averaged over the sessions
      return Math.round((60 * this.minutes()) / this.reviewed);
    },
    difficulty: function () {
      // return a value from 0 to 1, with 0.5 representing "normal"
      // Normal = ~100 items in Apprentice bucket (stages 1-4)
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
    load: function () {
      // returns a value betweeen 0 and 1 representing the percentage of reviews
      // per day relative to maxLoad
      let raw = this.reviewsPerDay() / settings.maxLoad;
      return raw > 1 ? 1 : raw;
    },
    speed: function () {
      // returns a value between 0 and 1 representing the percentage of seconds
      // per review relative to maxSpeed
      let raw = this.secondsPerReview() / settings.maxSpeed;
      return raw > 1 ? 1 : raw;
    },
  };

  /*
   * ********* MAIN function to calculate and display metrics ********
   */
  async function render(itemData, apiv2) {
    // Get all reviews within interval hours of now
    let firstReviewDate = new Date(
      new Date().getTime() - settings.interval * 60 * 60 * 1000
    );
    let options = {
      last_update: firstReviewDate.toString(),
    };

    let reviewCollection = await wkof.Apiv2.fetch_endpoint("reviews", options);
    let newReviews = reviewCollection.data;

    // Save our first metric
    metrics.reviewed = newReviews.length;

    // Calculate and save our second set of metrics
    // findSessions() returns an Array of Session objects
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

    // Now populate the section and add it to the dashboard
    updateDashboard(metrics, settings);
  }

  function logMetrics(metrics) {
    console.log(
      `------ GanbarOmeter debug output ------
${metrics.reviewed} reviews in ${settings.interval} hours
${Math.round(10 * metrics.missesPerDay()) / 10} misses per day
${metrics.minutes()} total minutes
${metrics.sessions.length} sessions:`
    );
    metrics.sessions.forEach((s) => {
      console.log(
        `     - Start: ${s.startTime}
       End: ${s.endTime}
       Misses: ${s.misses}
       Reviews: ${s.len}
       Review minutes: ${s.minutes()}`
      );
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

  // Create an html <section> for our metrics and add to dashboard
  function updateDashboard(metrics, settings) {
    // Append our styling to the head of the doucment
    const gbStyle = document.createElement("style");
    gbStyle.id = script_id + "CSS";
    gbStyle.innerHTML = css;
    document.querySelector("head").append(gbStyle);

    let html =
      `<label>Daily averages for the past ${settings.interval} hours</label>` +
      renderDiv(
        "gbDifficulty",
        "Difficulty",
        `${metrics.apprentice} (${metrics.newKanji})`
      ) +
      renderDiv("gbLoad", "Load", "reviews/day") +
      renderDiv("gbSpeed", "Speed", "sec/review");

    // Create a section for our content
    const gbSection = document.createElement("Section");
    gbSection.classList.add(`${script_id}`);
    gbSection.innerHTML = html;

    let gauge = gbSection.querySelector("#gbDifficulty");
    setGaugeValue(gauge, metrics.difficulty());

    gauge = gbSection.querySelector("#gbLoad");
    setGaugeValue(gauge, metrics.load(), `${metrics.reviewsPerDay()}`);

    gauge = gbSection.querySelector("#gbSpeed");
    setGaugeValue(gauge, metrics.speed(), `${metrics.secondsPerReview()}`);

    // Now add our new section at the just before the forum list
    document.querySelector(".progress-and-forecast").before(gbSection);
  }

  function renderDiv(id, title, text) {
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
    if (value < 0 || value > 1) {
      return;
    }

    let display = displayValue ? displayValue : `${Math.round(value * 100)}%`;

    gauge.querySelector(".gauge__fill").style.transform = `rotate(${
      value / 2
    }turn)`;
    gauge.querySelector(".gauge__cover").textContent = display;

    if (value >= 0.9) {
      gauge.querySelector(".gauge__fill").style.backgroundColor = "#e50036";
    } else if (value >= 0.8) {
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
  function Session(firstIndex, length, startTime, endTime, misses) {
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
          new Date(review.data_updated_at).getTime(), // newTime
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
    return timeDifference <= maxMinutes * 1000 * 60 * 60;
  }
})(window.wkof);
