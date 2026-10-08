// The touch scenarios in Chrome for Android through Appium: the same code path the iOS project uses.
import { androidAppiumTest } from '../lib/appium';
import { touchScenarios } from '../scenarios/touch';

touchScenarios(androidAppiumTest);
