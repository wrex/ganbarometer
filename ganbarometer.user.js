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

(function (wkof, review_cache) {
  "use strict";

  /*
   * * * * User Editable * * *
   */

  // Number of hours to summarize reviews over
  const interval = 72;

  // Number of minutes since prior review for a subsequent review
  // to be considered in the same session
  const sessionIntervalMax = 10;

  // Print debug messages to console?
  const debug = true;

  /*
   * * * * End of user editable variables * * *
   */

  // This script identifiers for caches, etc.
  const script_id = "ganbarometer";
  const script_name = "Ganbarometer";

  // Ensure WKOF is installed
  if (!wkof) {
    let response = confirm(`${script_name} requires WaniKani Open Framework.
Click "OK" to be forwarded to installation instructions.`);
    if (response) {
      window.location.href =
        "https://community.wanikani.com/t/instructions-installing-wanikani-open-framework/28549";
      return;
    }
  }

  // Wait until modules are ready then initiate script
  wkof.include("ItemData,Apiv2");
  wkof.ready("ItemData,Apiv2").then(render);

  // Values we are after
  const Stats = function (reviewed, minutes, misses, apprentice, rk12) {
    this.reviewed = reviewed; // #items revewed over interval
    this.minutes = minutes; // total review minutes over interval
    this.misses = misses; // # items answered incorrectly over interval
    this.apprentice = apprentice; // # items in Apprentice stages
    this.rk12 = rk12; // # radical and kanji items in stages 1 and 2
  };
  const stats = new Stats(0, 0, 0, 0, 0);

  // Main routine to display the stats
  async function render() {
    // Get all reviews, then filter out just the most recent
    let allReviews = await review_cache.get_reviews();
    let newReviews = filterRecent(allReviews, interval);

    stats.reviewed = newReviews.length;

    if (debug) {
      console.log(
        `GanbarOmeter: ${stats.reviewed} items reviewed over past ${interval} hours.`
      );
    }

    let sessions = findSessions(newReviews);
    if (debug) {
      console.log(`GanbarOmeter: ${sessions.length} review sessions`);
    }
  }

  function filterRecent(reviews, hours) {
    return reviews.filter(
      // a = [creationDate, subjectID, startingSRS, incorrectMeaning, incorrectReading]
      (a) => a[0] > Date.now() - hours * 60 * 60 * 1000
    );
  }

  // A Session object holds an index into an array of reviews, plus a length
  function Session(firstIndex, length, startTime, endTime) {
    this.firstIndex = firstIndex;
    this.len = length;
    this.startTime = startTime;
    this.endTime = endTime;
    this.minutes = (this.endTime - this.startTime) / (1000 * 60);
  }

  // Find strings of reviews no more than sessionIntervalMax apart
  function findSessions(reviews) {
    // Start with an empty array of sessions
    let sessions = [];

    // Get the time of the first review
    let firstTime = reviews.length > 0 ? new Date(reviews[0][0]) : new Date(0);

    // Create a session for the first review, but zero length
    // Set the start and end times to the time of the very first review
    let curSession = new Session(0, 0, firstTime, firstTime);

    // iterate through reviews to find sessions
    reviews.forEach((review) => {
      if (withinSessionRange(curSession.endTime, review)) {
        // Still within a session, so increment the length
        curSession.len += 1;
        // And update the endTime the the time of this review
        curSession.endTime = new Date(review[0]);
      } else {
        // New session, so push the old one onto the array
        sessions.push(curSession);

        // And create a new curSession of length 1 for this review
        let newIndex = curSession.firstIndex + curSession.len;
        let newDate = new Date(review[0]);
        curSession = new Session(newIndex, 1, newDate, newDate);
      }
    });

    // Finally, push the last session onto the array
    sessions.push(curSession);

    return sessions;
  }

  function withinSessionRange(sessionStart, review) {
    let timeDifference = review[0] - sessionStart;
    return timeDifference <= sessionIntervalMax * 1000 * 60 * 60;
  }
})(window.wkof, window.review_cache);
