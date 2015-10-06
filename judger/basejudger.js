'use strict';
var Buffer = require('buffer');
// var ByteOrder = require('network-byte-order');
var Net = require('net');
var Promise = require('promise');
var config = require('../config.js');



/**
 * Base class for virtual judger.
 * @constructor @struct @package
 */
var BaseJudger = function(judgerId) {
  /**
   * Socket object for communication with dispatcher.
   * @private @const {!Net.Socket}
   */
  this.client_ = new Net.Socket();
  this.client_.setEncoding('utf8');

  /**
   * Identifier for virtual judger.
   * @private @const {string}
   */
  this.judgerId_ = judgerId;

  /** @private {string} */
  this.receivedData_ = null;

  /** @private {number} */
  this.receivedBytes_ = 0;

  /** 
   * Indicates how many bytes has been read from the buffer.
   * @private {number}
   */
  this.readBytes_ = 0;

  /** @private {boolean} */
  this.loggedIn_ = false;
};


/**
 * Enum for judge failure reasons.
 * @protected @enum
 */
BaseJudger.ERRORS = {
  SAME_CODE: 'Same code',
  INVALID_LANGUAGE: 'Invalid language',
  COMPILE_ERROR: 'Compile error',
  LOGIN_FAILED: 'Login failed',
  OTHERS: 'Other'
};


/**
 * Type number defined by the backend for RESULT_REPORT.
 * @private {number}
 */
BaseJudger.RESULT_REPORT_ = 1003;


/**
 * Starts the judger.
 * @return {!BaseJudger}
 * @public
 */
BaseJudger.prototype.start = function() {
  this.connect_();
  this.client_.on('data', this.onData_.bind(this));
  this.client_.on('error', this.onError_.bind(this));
  this.client_.on('close', this.onClose_.bind(this));
  return this;
};


/**
 * Connects the judger to the dispatcher.
 * @private
 */
BaseJudger.prototype.connect_ = function() {
  this.client_.connect({
    host: config.dispatcher.host,
    port: config.dispatcher.port
  }, (function() {
    this.log('Server connected.');
    this.client_.write(config.dispatcher.secret);
  }).bind(this));
};


/**
 * Handles when socket connection is closed.
 * @param {boolean} hadError
 * @private
 */
BaseJudger.prototype.onClose_ = function(hadError) {
  if (!hadError) {
    this.reconnect_();
  }
};


/**
 * Handles when there's error in the connection.
 * @param {!Object} err
 * @private
 */
BaseJudger.prototype.onError_ = function(err) {
  this.log('Error in connection: ' + err.toString());
  this.reconnect_();
};


/**
 * Tries to reconnect to the dispatcher.
 * @private
 */
BaseJudger.prototype.reconnect_ = function() {
  this.log('Lost connection. Retrying in 5 seconds...');
  setTimeout(this.connect_.bind(this), 5000);
};


/**
 * Handles dispatcher data, and triggers judge when message is complete.
 * @param {!Buffer} data
 * @private
 */
BaseJudger.prototype.onData_ = function(data) {
  if (this.receivedBytes_ == 0) {
    // Reads first 4 bytes.
    // this.receivedBytes_ = ByteOrder.ntohl(data, 0);
    this.receivedBytes_ = data.readIntBE(0, 4);
    this.readBytes_ = data.length - 4;
    this.receivedData_ = data.slice(4);
  } else {
    // Continue reading. Assuming we won't have two messages sent at the same
    // socket.
    this.readBytes_ = data.length;
    this.receivedData_ = Buffer.concat([this.receivedBytes_, data], 2);
  }
  if (this.readBytes_ == this.receivedBytes_) {
    // Message complete, begins to judge.
    var info = JSON.parse(this.receivedData_.toString());
    this.receivedBytes_ = 0;
    this.maybeJudge_(info);
  }
};


/**
 * Checks for basic eligibility for this submit, to see whether it can be
 * judged.
 * @param {!Object} info The info of this submit.
 * @private
 */
BaseJudger.prototype.maybeJudge_ = function(info) {
  try {
    info.language = this.getLanguage(info.language);
    if (!this.loggedIn_) {
      this.login().then(this.judge_.bind(this, info),
          this.onFailed.bind(this, info, BaseJudger.ERRORS.LOGIN_FAILED));
    }
  } catch(err) {
    this.onFailed(info, BaseJudger.ERRORS.INVALID_LANGUAGE);
  }
};


/**
 * Judges the submit and sends back the result when it's done.
 * @param {!Object} info The info of this submit.
 * @private
 */
BaseJudger.prototype.judge_ = function(info) {
  this.submit(info).then(this.onSubmitted_.bind(this, info), (err) => {
    // Assume not logged in.
    this.log('Error: ' + err);
    this.log('Submit failed, assume not logged in.');
    this.login().then(() => {
      this.submit(info).then(this.onSubmitted_.bind(this, info), (err) => {
        this.log('Error: ' + err);
        this.log('Submit failed, assume too fast.');
        setTimeout((function() {
          this.submit(info).then(
              this.onSubmitted_.bind(this, info),
              (err) => this.onFailed.bind(this, info, err));
        }).bind(this), this.getWaitTime());
      })
    }, this.onFailed.bind(this, info, BaseJudger.ERRORS.LOGIN_FAILED));
  });
};


/**
 * Handles when user's code has been successfully submitted.
 * @param {!Object} info
 * @private
 */
BaseJudger.prototype.onSubmitted_ = function(info) {
  this.getStatus().then((result) => {
    result.type = BaseJudger.RESULT_REPORT_;
    result.runid = info.runid;
    this.onResult_(result);
  }, (err) => this.onFailed.bind(this, info, err));
};


/**
 * Handles when verdict is in for user's submit.
 * @param {!Object} result
 * @private
 */
BaseJudger.prototype.onResult_ = function(result) {
  if (result.result == 'Compile Error') {
    this.getCompileInfo().then((info) => {
      result.compileInfo = info;
      this.sendResult_(result);
    }, () => {
      this.log('Error in getting compile info, use empty info instead.');
      result.compileInfo = '';
      this.sendResult_(result);
    })
  } else {
    this.sendResult_(result);
  }
};


/**
 * Handles when this submission failed.
 * @param {!Object} result
 * @param {string} reason
 * @protected
 */
BaseJudger.prototype.onFailed = function(info, reason) {
  this.log('Submit failed, reason: ' + reason + '. Report back to dispatcher');
  var result = {};
  result.type = BaseJudger.RESULT_REPORT_;
  result.runid = info.runid;
  result.memoryUsed = result.timeUsed = result.remoteRunid = '0';
  result.compileInfo = '';
  if (reason == BaseJudger.ERRORS.COMPILE_ERROR) {
    result.result = 'Compile Error';
  } else if (reason == BaseJudger.ERRORS.SAME_CODE) {
    result.result = 'Judge Error (Same Code)';
  } else if (reason == BaseJudger.ERRORS.INVALID_LANGUAGE) {
    result.result = 'Judge Error (Invalid Language)';
  } else {
    result.result = 'Judge Error';
  }
};


/**
 * Sends the result back to dispatcher.
 * @param {!Object} result
 * @private @virtual
 */
BaseJudger.prototype.sendResult_ = function(result) {
  this.log('Done judging. Result: ' + result.result + ', remote runid' +
      result.remoteRunid);
  var buffer = new Buffer(JSON.stringify(result));
  var length = new Buffer(4);
  length.writeIntBE(buffer.length, 0, 4);
  this.client_.write(length);
  this.client_.write(buffer);
};


/**
 * Converts language to map remote oj.
 * @param {string} language
 * @return {string}
 * @protected @virtual
 */
BaseJudger.prototype.getLanguage = function(language) {
  throw new Error('GetLanguage must be implemented!');
};


/**
 * Handles get compile info action.
 * @return {!Promise<string>}
 * @protected @virtual
 */
BaseJudger.prototype.getCompileInfo = function() {
  throw new Error('GetCompileInfo must be implemented!');
};


/**
 * Handles login action.
 * @return {!Promise}
 * @protected @virtual
 */
BaseJudger.prototype.login = function() {
  throw new Error('Login must be implemented!');
};


/**
 * Handles submit action.
 * @param {!Object} info Submit info
 * @return {!Promise}
 * @protected @virtual
 */
BaseJudger.prototype.submit = function(info) {
  throw new Error('Submit must be implemented!');
};


/**
 * Handles submit action.
 * @return {!Promise<{
 *   memoryUsed: string,
 *   timeUsed: string,
 *   result: string,
 *   remoteRunid: string
 * }>}
 * @protected @virtual
 */
BaseJudger.prototype.getStatus = function() {
  throw new Error('getStatus must be implemented!');
};


/**
 * Logs the message to the file.
 * @param {string} message
 * @protected
 */
BaseJudger.prototype.log = function(message) {
  console.log('[' + this.judgerId_ + ']: ' + message);
};


module.exports = BaseJudger;
