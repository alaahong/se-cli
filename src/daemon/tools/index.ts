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
};
