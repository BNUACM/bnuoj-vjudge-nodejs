'use strict';
var BaseJudger = require('./basejudger.js');
var Cheerio = require('cheerio');
var Promise = require('promise');
var Unirest = require('unirest');
var Util = require('util');



/**
 * Virtual judger for A2oj.
 * @param {string} username
 * @param {string} password
 * @param {number} timeout
 * @extends {BaseJudger}
 * @constructor @struct @public @final
 */
var A2ojJudger = function(username, password, timeout) {
  /** @private @const {string} */
  this.username_ = username;

  /** @private @const {string} */
  this.password_ = password;

  /**
   * Time limit for each http request.
   * @private @const {number}
   */
  this.timeout_ = timeout;

  /** @private @const {!Unirest.jar} */
  this.cookie_ = Unirest.jar();

  /** @private {?string} */
  this.statusUrl_ = null;

  /** @private @const {!Object} */
  this.languageTable_ = {
    '1': '41',
    '2': '11',
    '3': '10',
    '4': '22',
    '5': '4',
    '6': '27',
    '7': '5',
    '8': '3',
    '9': '17',
    '10': '7'
  };

  A2ojJudger.super_.call(this, 'A2OJ:' + username);
};
Util.inherits(A2ojJudger, BaseJudger);


/** @override */
A2ojJudger.prototype.getLanguage = function(language) {
  if (!this.languageTable_[language]) {
    throw 'Invalid language';
  }
  return this.languageTable_[language];
};


/**
 * Handles get compile info action.
 * @return {!Promise<string>}
 * @protected @virtual
 */
A2ojJudger.prototype.getCompileInfo = function() {
  throw new Error('GetCompileInfo must be implemented!');
};


/** @override */
A2ojJudger.prototype.login = function() {
  return new Promise((function(resolve, reject) {
    this.log('Start to login.');
    Unirest.post('http://www.a2oj.com/SignInCode.jsp')
        .followAllRedirects(true)
        .timeout(this.timeout_ * 1000)
        .jar(this.cookie_)
        .send({
          'Username': this.username_,
          'Password': this.password_,
          'rm': 'on'
        }).end((function (response) {
          if (!response.ok) {
            this.log('Fail to login, server error.');
            reject();
          } else if (response.body.indexOf('action="SignInCode.jsp"') >= 0) {
            this.log('Fail to login, please check username and password.');
            reject();
          } else {
            this.log('Login succeed.');
            resolve();
          }
        }).bind(this));
  }).bind(this));
};


/** @override */
A2ojJudger.prototype.submit = function(info) {
  return new Promise((function(resolve, reject) {
    Unirest.post('http://www.a2oj.com/SubmitCode.jsp')
        .followAllRedirects(true)
        .timeout(this.timeout_ * 1000)
        .jar(this.cookie_)
        .send({
          'ProblemID': info.vid,
          'LanguageID': info.language,
          'Code': info.source
        }).end((function (response) {
          var needle = '<center>Your solution has been ' +
              'submitted successfully</center>';
          if (!response.ok) {
            this.log('Fail to submit, server error.');
            reject();
          } else if (response.body.indexOf(needle) < 0) {
            this.log('Fail to submit, something is not right in this run.');
            reject();
          } else {
            this.log('Submit succeed.');
            this.statusUrl_ = response.url.toString();
            resolve();
          }
        }).bind(this));
  }).bind(this));
};


/**
 * Handles submit action.
 * @return {!Promise<{
 *   memoryUsed: string,
 *   timeUsed: string,
 *   result: string,
 *   remoteRunid: sring
 * }>}
 * @protected @virtual
 */
A2ojJudger.prototype.getStatus = function() {
  return new Promise((function(resolve, reject) {
    if (!this.statusUrl_) {
      this.log('Fail to fetch status, unable to construct url.');
      reject();
      return;
    }
    var startTime = Date.now();
    while (Date.now() - startTime < this.timeout_ * 1000) {
      Unirest.get(this.statusUrl_)
          .timeout(this.timeout_ * 1000)
          .jar(this.cookie_)
          .end((function (response) {
          }).bind(this));
    }
  }).bind(this));
};


module.exports = A2ojJudger;