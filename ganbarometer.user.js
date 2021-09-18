// ==UserScript==
// @name         Ganbarometer
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Add Pace and Difficulty gauges to the Wanikani Dashboard
// @author       Rex Walters (Rrwrex AKA rw [at] pobox.com)
// @copyright    2021 Rex Robert Walters
// @license      MIT-0 https://opensource.org/licenses/MIT-0
// @include      /^https://(www|preview).wanikani.com/(dashboard)?$/
// @require      https://greasyfork.org/scripts/410909-wanikani-review-cache/code/Wanikani:%20Review%20Cache.js
// @grant        none
// ==/UserScript==
//
// Note: This script uses the cache from Kumirei's Review Cache:
// https://community.wanikani.com/t/userscript-review-cache/46162
//
// Since this script only needs a few days of reviews, I could have eliminated
// a dependency and allowed the script to load much faster by using
// wkof.Apiv2.fetch_endpoint() instead of get_reviews(), but I figured many
// users of this script will also install Kumire's wonderful Heatmap script
// (https://community.wanikani.com/t/userscript-wanikani-heatmap/34947).
// So I thought it made sense to share the same cache.
//
// I may revisit this decision in a future version, though.

(function (wkof, review_cache) {
  "use strict";

  /*
   * * * * User Modifiable Constants * * *
   */

  const settings = {
    debug: true,
    interval: 27, // Number of hours to summarize reviews over
    sessionIntervalMax: 10, // max minutes between reviews in same session
    newKanjiWeighting: 0.05, // weighting factor for new kanji (10items = 50% harder)
    normalApprenticeQty: 100, // normal number of items in apprentice queue
    maxLoad: 300, // maximum number of reviews per day in load graph (50% is normal)
    maxSpeed: 30, // maximum number of seconds per review in speed graph (50% is normal)
  };

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
  wkof.include("ItemData, Apiv2");
  wkof.ready("ItemData, Apiv2").then(render);

  // The metrics we want to retrieve and display
  const metrics = {
    reviewed: 0, // TBD: total number of items reviewed over interval
    sessions: [], // TBD: array of Session objects
    apprentice: 0, // TBD: total number of items currently in Apprentice (stages 1-4)
    newKanji: 0, // TBD: total number of radicals & kanji in stages 1 or 2
    minutes: function () {
      // total number of minutes spent reviewing over interval
      let min = 0;
      for (let sess of this.sessions) {
        min += sess.minutes();
      }
      return min;
    },
    misses: function () {
      // number of review items answered incorrectly over interval
      let s = 0;
      for (let sess of this.sessions) {
        s += sess.misses;
      }
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
      // return a value from 0 to 100, with 50 representing "normal"
      // Normal = 100 items in Apprentice bucket (stages 1-4)
      // but kanji in stages 1 and 2 are more difficult
      // so weight them heavily (10 such items make it 50% more difficult)
      let weighting = 1 + this.newKanji * settings.newKanjiWeighting;
      let raw = Math.round(
        (this.apprentice / settings.normalApprenticeQty) * 50 * weighting
      );
      return raw > 100 ? 100 : raw;
    },
    load: function () {
      // returns a value betweeen 0 and 300 representing the number of reviews
      // per day capped at a value of 300 (for gauge display)
      return this.reviewsPerDay() > settings.maxLoad
        ? settings.maxLoad
        : this.reviewsPerDay();
    },
    speed: function () {
      // returns a value between 0 and 30 representing the seconds per review
      // capped at a value of 30 (for gauge display)
      return this.secondsPerReview() > settings.maxSpeed
        ? settings.maxSpeed
        : this.secondsPerReview();
    },
  };

  /*
   * ********* MAIN function to calculate and display metrics ********
   */
  async function render(itemData, apiv2) {
    // Get all reviews, then filter out all but the most recent
    // get_reviews() returns an Array of "reviews" (each review is an Array)
    // each individual array contains:
    // [creationDate, subjectID, startingSRS, incorrectMeaning, incorrectReading]
    let allReviews = await review_cache.get_reviews();
    let newReviews = filterRecent(allReviews, settings.interval);
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
      console.log(
        `${metrics.reviewed} reviews in ${settings.interval} hours (${
          allReviews.length
        } total reviews)
${metrics.misses()} total misses
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
      console.log(`${metrics.load()} reviews per day (0-300)`);
      console.log(`${metrics.speed()} seconds per review (0-30)`);
      console.log(`Difficulty: ${metrics.difficulty()} (0-100)`);
    }

    // Now populate the section and add it to the dashboard
    updateDashboard(metrics, settings);
  }

  // Create an html <section> for our metrics and add to dashboard
  function updateDashboard(metrics, settings) {
    let css = `
section.ganbarometer {
    display: flex;
    justify-content: space-evenly;
}

.ganbarometer h1, .ganbarometer p {
    text-align: center;
    justify-content: center;
}

.gbGauge {
    position: relative;
    background: var(--gauge-bg);
    border: 0.05em solid #222222;
    border-radius: 50%;
    min-width: 150px;
    min-height: 150px;
    font-weight: bold;
    font-size: 20px;
}

.gbGauge .ticks {
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0%;
    left: 0%;
}

.gbGauge .ticks .min {
    background: black;
    position: relative;
    left: 0%;
    top: 50%;
    width: 100%;
    height: 1%;
    margin-bottom: -1%;
    background: linear-gradient(90deg, rgba(2, 0, 36, 0) 0%, rgba(0, 0, 0, 0) 4%, rgba(0, 0, 0, 1) 4%, rgba(0, 0, 0, 1) 15%, rgba(0, 0, 0, 0) 15%);
    transform: rotate(-45deg);
}

.gbGauge .ticks .mid {
    background: black;
    position: relative;
    left: 0%;
    top: 50%;
    width: 100%;
    height: 1%;
    margin-bottom: -1%;
    background: linear-gradient(90deg, rgba(2, 0, 36, 0) 0%, rgba(0, 0, 0, 0) 4%, rgba(0, 0, 0, 1) 4%, rgba(0, 0, 0, 1) 15%, rgba(0, 0, 0, 0) 15%);
    transform: rotate(90deg);
}

.gbGauge .ticks .max {
    background: black;
    position: relative;
    left: 0%;
    top: 50%;
    width: 100%;
    height: 1%;
    margin-bottom: -1%;
    background: linear-gradient(90deg, rgba(2, 0, 36, 0) 0%, rgba(0, 0, 0, 0) 4%, rgba(0, 0, 0, 1) 4%, rgba(0, 0, 0, 1) 15%, rgba(0, 0, 0, 0) 15%);
    transform: rotate(225deg);
}

.gbGauge .ticks .tithe {
    transform: rotate(calc(27deg * var(--gauge-tithe-tick) - 45deg));
    background: black;
    position: relative;
    left: 0%;
    top: 50%;
    width: 100%;
    height: 1%;
    margin-bottom: -1%;
    background: linear-gradient(90deg, rgba(2, 0, 36, 0) 0%, rgba(0, 0, 0, 0) 10%, rgba(0, 0, 0, 1) 10%, rgba(0, 0, 0, 1) 15%, rgba(0, 0, 0, 0) 15%);
}

.gbGauge .tick-circle {
    position: absolute;
    top: 15%;
    left: 15%;
    width: calc(70% - 0.1em);
    height: calc(70% - 0.1em);
    border-left: 0.1em solid;
    border-top: 0.1em solid;
    border-right: 0.1em solid;
    border-bottom: 0.1em solid transparent;
    border-radius: 50%;
}

.gbGauge .needle {
    /* Gauge value range 0-100 */
    transform: rotate(calc(270deg * calc(var(--gauge-value, 0deg) / 100) - 45deg));
    background: black;
    position: relative;
    left: 0%;
    top: 49%;
    width: 100%;
    height: 4%;
    margin-bottom: -4%;
    background: linear-gradient(90deg, rgba(2, 0, 36, 0) 0%, rgba(0, 0, 0, 0) 24%, rgba(0, 0, 0, 1) 24%, rgba(0, 0, 0, 1) 30%, rgba(0, 0, 0, 0) 50%);
}

.gbGauge .needle .needle-head {
    position: relative;
    top: 15%;
    left: 22.5%;
    width: 2.7%;
    height: 70%;
    background-color: black;
    transform: rotate(-45deg);
}

.gbGauge .labels {
    position: absolute;
    width: 100%;
    height: 100%;
}

.gbGauge .labels .value-label {
    position: relative;
    top: 75%;
    text-align: center;
}

.gbGauge .labels .value-label::after {
    counter-reset: gauge-value var(--gauge-display-value);
    content: counter(gauge-value);
}

.guide-x, .guide-y {
    background-color: orange;
    visibility: visible;
    position: absolute;
    left: 50%;
    top: 0;
    width: 1px;
    height: 100%;
}

.guide-y {
    left: 0;
    top: 50%;
    width: 100%;
    height: 1px;
}`;

    // Append our styling to the head of the doucment
    const gbStyle = document.createElement("style");
    gbStyle.id = script_id + "CSS";
    gbStyle.innerHTML = css;

    document.querySelector("head").append(gbStyle);

    let html =
      renderDiv("Difficulty", 54, 54, "0 - 100") +
      renderDiv("Load", 37, 111, "0 - 300") +
      renderDiv("Speed", 48, 15, "0-30");

    // Create a section for our content
    const gbSection = document.createElement("Section");
    gbSection.classList.add(`${script_id}`);
    gbSection.innerHTML = html;
    // Now add our new section at the just before the forum list
    document.querySelector(".progress-and-forecast").before(gbSection);
  }

  function renderDiv(title, value, displayValue, text) {
    return `<div>
    <h1>${title}</h1>
    <div id="demoGauge" class="gbGauge" style="
        --gauge-value:${value};
        --gauge-display-value:${displayValue};
        width: 150px;
        height: 150px;">

        <div class="guide">
            <div class="guide-x"></div>
            <div class="guide-y"></div>
        </div>

        <div class="ticks">
            <div class="tithe" style="--gauge-tithe-tick:1;"></div>
            <div class="tithe" style="--gauge-tithe-tick:2;"></div>
            <div class="tithe" style="--gauge-tithe-tick:3;"></div>
            <div class="tithe" style="--gauge-tithe-tick:4;"></div>
            <div class="tithe" style="--gauge-tithe-tick:6;"></div>
            <div class="tithe" style="--gauge-tithe-tick:7;"></div>
            <div class="tithe" style="--gauge-tithe-tick:8;"></div>
            <div class="tithe" style="--gauge-tithe-tick:9;"></div>
            <div class="min"></div>
            <div class="mid"></div>
            <div class="max"></div>
        </div>
        <div class="tick-circle"></div>

        <div class="needle">
            <div class="needle-head"></div>
        </div>
        <div class="labels">
            <div class="value-label"></div>
        </div>
    </div>
    <p>${text}</p>
</div>`;
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
      return Math.round((this.endTime - this.startTime) / (1000 * 60));
    };
  }

  // Find sequences of reviews no more than sessionIntervalMax apart
  function findSessions(reviews) {
    // Start with an empty array of sessions
    let sessions = [];
    // Get the time of the first review
    let firstTime = reviews.length > 0 ? new Date(reviews[0][0]) : new Date(0);
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
          review[0], // newTime
          settings.sessionIntervalMax // maxMinutes
        )
      ) {
        // Still within a session, so increment the length
        curSession.len += 1;
        // "miss" means one or more incorrect meaning or reading answers
        curSession.misses += review[3] + review[4] > 0 ? 1 : 0;
        // Update endTime the the time of this review
        curSession.endTime = new Date(review[0]);
      } else {
        // Finished prior session and starting a new one
        sessions.push(curSession);
        // And create a new curSession of length 1 for this review
        let newIndex = curSession.firstIndex + curSession.len;
        let newDate = new Date(review[0]);
        let curMisses = review[3] + review[4] > 0 ? 1 : 0;
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
})(window.wkof, window.review_cache);
