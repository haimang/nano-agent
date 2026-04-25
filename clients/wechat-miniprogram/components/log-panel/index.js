// components/log-panel/index.js
Component({
  properties: {
    logs: {
      type: Array,
      value: [],
    },
  },

  data: {},

  methods: {
    clearLogs() {
      this.triggerEvent('clear');
    },
  },
});
