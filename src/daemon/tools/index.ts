import { browser_goto } from './goto';
import { browser_go_back, browser_go_forward, browser_reload } from './navigation';
import { browser_title } from './title';
import { browser_url } from './url';
import { browser_click } from './click';
import { browser_fill } from './fill';
import { browser_type } from './type';
import { browser_press } from './press';
import { browser_select } from './select';
import { browser_check, browser_uncheck } from './check';
import { browser_snapshot } from './snapshot';
import { browser_find } from './find';
import { browser_screenshot } from './screenshot';
import { browser_eval } from './eval';
import {
  browser_cookie_list,
  browser_cookie_get,
  browser_cookie_set,
  browser_cookie_delete,
  browser_localstorage_get,
  browser_localstorage_set,
  browser_localstorage_delete,
  browser_localstorage_list,
  browser_sessionstorage_get,
  browser_sessionstorage_set,
  browser_sessionstorage_delete,
  browser_sessionstorage_list,
} from './storage';
import {
  browser_tab_list,
  browser_tab_new,
  browser_tab_close,
  browser_tab_select,
} from './tab';
import {
  browser_state_save,
  browser_state_load,
} from './state';

export const tools: Record<string, (driver: any, params: any, response: any) => Promise<void>> = {
  browser_goto,
  browser_go_back,
  browser_go_forward,
  browser_reload,
  browser_title,
  browser_url,
  browser_click,
  browser_fill,
  browser_type,
  browser_press,
  browser_select,
  browser_check,
  browser_uncheck,
  browser_snapshot,
  browser_find,
  browser_screenshot,
  browser_eval,
  browser_cookie_list,
  browser_cookie_get,
  browser_cookie_set,
  browser_cookie_delete,
  browser_localstorage_get,
  browser_localstorage_set,
  browser_localstorage_delete,
  browser_localstorage_list,
  browser_sessionstorage_get,
  browser_sessionstorage_set,
  browser_sessionstorage_delete,
  browser_sessionstorage_list,
  browser_tab_list,
  browser_tab_new,
  browser_tab_close,
  browser_tab_select,
  browser_state_save,
  browser_state_load,
};
