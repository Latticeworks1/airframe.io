/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Component {
  type: string;
}

export interface Entity {
  id: string;
  components: Map<string, Component>;
}

export interface Environment {
  id: string;
  components: Map<string, Component>;
}
