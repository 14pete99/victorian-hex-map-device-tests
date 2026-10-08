// The touch scenarios in Chrome for Android, with every touch written to the device's touchscreen.
import { androidScreenTest } from '../lib/android';
import { touchScenarios } from '../scenarios/touch';

touchScenarios(androidScreenTest);
