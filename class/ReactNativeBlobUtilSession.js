// @flow
// Copyright 2016 wkh237@github. All rights reserved.
// Use of this source code is governed by a MIT-style license that can be
// found in the LICENSE file.

import {requireNativeModule} from '../utils/nativeModule';
let sessions = {};

export default class ReactNativeBlobUtilSession {

  name : string;

  static getSession(name:string):any {
    return sessions[name];
  }

  static setSession(name:string, val:any) {
    sessions[name] = val;
  }

  static removeSession(name:string) {
    delete sessions[name];
  }

  constructor(name:string, list:Array<string>) {
    this.name = name;
    if (!sessions[name]) {
      if (Array.isArray(list))
      sessions[name] = list;
      else
      sessions[name] = [];
    }
  }

  add(path:string):ReactNativeBlobUtilSession {
    sessions[this.name].push(path);
    return this;
  }

  remove(path:string):ReactNativeBlobUtilSession {
    let list = sessions[this.name];
    for (let i = 0; i < list.length; i++) {
      if (list[i] === path) {
        sessions[this.name].splice(i, 1);
        break;
      }
    }
    return this;
  }

  list():Array<string> {
    return sessions[this.name];
  }

  dispose(): Promise<void> {
    return requireNativeModule().removeSession(sessions[this.name] || []).then(() => {
      delete sessions[this.name];
    });
  }

}
