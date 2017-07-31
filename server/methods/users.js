'use strict';
import { _ } from 'meteor/underscore';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Accounts } from 'meteor/accounts-base';
import { lockManager } from '../../lockManager';
import { dbValidatingUsers } from '../../db/dbValidatingUsers';
import { dbCompanies } from '../../db/dbCompanies';
import { dbLog } from '../../db/dbLog';
import { dbConfig } from '../../db/dbConfig';
import { config } from '../../config';

Meteor.methods({
  loginOrRegister(username, password) {
    check(username, String);
    check(password, String);

    if (Meteor.users.findOne({username})) {
      return true;
    }
    else {
      const existValidatingUser = dbValidatingUsers.findOne({username, password});
      let validateCode;
      if (existValidatingUser) {
        validateCode = existValidatingUser.validateCode;
      }
      else {
        validateCode = generateValidateCode();
        const createdAt = new Date();
        dbValidatingUsers.insert({username, password, validateCode, createdAt});
      }

      return validateCode;
    }
  }
});

const randomStringList = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateValidateCode() {
  return _.sample(randomStringList, 10).join('');
}

Meteor.methods({
  validateAccount(username) {
    check(username, String);
    const unlock = lockManager.lock(['validate']);
    const result = validateUsers(username);
    unlock();
    if (result) {
      return true;
    }
    else if (Meteor.users.findOne({username})) {
      return true;
    }
    else {
      throw new Meteor.Error('[403] Forbidden', '驗證未能通過，請確定推文位置、推文文章、推文方式與推文驗證碼是否正確！');
    }
  }
});

const getValidateUserUrlBodySync = Meteor.wrapAsync((callback) => {
  const request = require('request');
  const cheerio = require('cheerio');
  const configData = dbConfig.findOne();
  request(configData.validateUserUrl, (error, response, body) => {
    if (error) {
      callback(error);
    }
    else {
      const $pushList = cheerio.load(body)('div.push');
      callback(null, $pushList);
    }
  });
});
function validateUsers(checkUsername) {
  const validatingUserData = dbValidatingUsers.find({username:checkUsername},{disableOplog:true}).fetch();
  if (validatingUserData.length !== 1)
    return false;

  const $pushList = getValidateUserUrlBodySync();
  const validatingUserdata = validatingUserData[0];
  const username = validatingUserdata.username;
  const validateCode = validatingUserdata.validateCode;

  //$userPushList will get last comment
  const $userPushList = $pushList.find('.push-userid:contains(' + username + ')').closest('.push').last();

  if ($userPushList.length !== 1)
    return false;

  const comment = $userPushList.find('.push-content').text().substring(2,2+validateCode.length);
  if ( !validateCode || comment !== validateCode )
    return false;

  const password = validatingUser.password;
  const existUser = Meteor.users.findOne({username});
  if (existUser) {
    Accounts.setPassword(existUser._id, password, {
      logout: true
    });
    dbValidatingUsers.remove({_id: validatingUser._id});
  }
  else {
    const profile = {
      money: config.beginMoney
    };
    Accounts.createUser({username, password, profile});
    dbLog.insert({
      logType: '驗證通過',
      username: [username],
      price: config.beginMoney,
      createdAt: new Date()
    });
    dbValidatingUsers.remove({_id: validatingUser._id});
  }
  return true;
}

Meteor.publish('accountInfo', function(username) {
  check(username, String);

  const result = [];
  if (username) {
    result.push(
      Meteor.users.find({username}, {
        fields: {
          username: 1,
          profile: 1,
          createdAt: 1
        }
      })
    );
  }
  else {
    result.push(
      Meteor.users.find({
        _id: this.userId
      }, {
        fields: {
          username: 1,
          profile: 1,
          createdAt: 1
        }
      })
    );
  }
  result.push(
    dbCompanies.find({
      manager: username
    })
  );

  return result;
});
Meteor.publish('accountInfoLog', function(username, offset) {
  check(username, String);
  check(offset, Match.Integer);
  if (! username && this.userId) {
    username = Meteor.users.findOne(this.userId).username;
  }

  dbLog.find({username}, {
    sort: {
      createdAt: -1
    },
    skip: offset,
    limit: 50 + offset
  }).observeChanges({
    added: (id, fields) => {
      this.added('log', id, fields);
    }
  });
  this.ready();
});
