// components/markdown-display/index.js
Component({
  properties: {
    markdown: {
      type: String,
      value: '',
      observer: function (newVal) {
        if (newVal) {
          this.parseMarkdown(newVal);
        } else {
          this.setData({ nodes: [] });
        }
      },
    },
  },

  data: {
    nodes: [],
  },

  methods: {
    parseMarkdown: function (mdString) {
      let nodes = [];
      const lines = mdString.replace(/\r\n/g, '\n').split('\n');

      let currentParagraphContent = [];
      let currentBlockquoteLines = [];
      let currentListType = null;
      let currentListItems = [];

      const pushParagraph = () => {
        if (currentParagraphContent.length > 0) {
          const paragraphText = currentParagraphContent.join('\n');
          nodes.push({
            name: 'p',
            attrs: { class: 'p' },
            children: this.parseInline(paragraphText),
          });
          currentParagraphContent = [];
        }
      };

      const pushBlockquote = () => {
        if (currentBlockquoteLines.length > 0) {
          const quoteText = currentBlockquoteLines.join('\n');
          nodes.push({
            name: 'blockquote',
            attrs: { class: 'blockquote' },
            children: this.parseInline(quoteText),
          });
          currentBlockquoteLines = [];
        }
      };

      const pushList = () => {
        if (currentListType && currentListItems.length > 0) {
          nodes.push({
            name: currentListType,
            attrs: { class: currentListType },
            children: currentListItems.map((item) => ({
              name: 'li',
              attrs: { class: 'li' },
              children: this.parseInline(item.text),
            })),
          });
        }
        currentListType = null;
        currentListItems = [];
      };

      lines.forEach((line) => {
        const trimmedLine = line.trim();
        let isHandled = false;

        // 图片
        const imgTagMatch = trimmedLine.match(/^!<img\s+src="([^"]+)"(?:\s+alt="([^"]*)")?\s*>$/);
        if (imgTagMatch) {
          pushParagraph();
          pushBlockquote();
          pushList();
          nodes.push({
            name: 'img',
            attrs: {
              class: 'inline-img',
              src: imgTagMatch[1],
              alt: imgTagMatch[2] || '',
            },
          });
          isHandled = true;
        }

        // 标题
        if (!isHandled && trimmedLine.startsWith('# ')) {
          pushParagraph();
          pushBlockquote();
          pushList();
          nodes.push({
            name: 'h1',
            attrs: { class: 'h1' },
            children: this.parseInline(trimmedLine.substring(2)),
          });
          isHandled = true;
        } else if (!isHandled && trimmedLine.startsWith('## ')) {
          pushParagraph();
          pushBlockquote();
          pushList();
          nodes.push({
            name: 'h2',
            attrs: { class: 'h2' },
            children: this.parseInline(trimmedLine.substring(3)),
          });
          isHandled = true;
        } else if (!isHandled && trimmedLine.startsWith('### ')) {
          pushParagraph();
          pushBlockquote();
          pushList();
          nodes.push({
            name: 'h3',
            attrs: { class: 'h3' },
            children: this.parseInline(trimmedLine.substring(4)),
          });
          isHandled = true;
        }

        // 引用
        if (!isHandled && trimmedLine.startsWith('>')) {
          pushParagraph();
          pushList();
          currentBlockquoteLines.push(trimmedLine.substring(1).trim());
          isHandled = true;
        }

        // 列表
        if (!isHandled) {
          const ulMatch = trimmedLine.match(/^(\*|-)\s+(.*)/);
          const olMatch = trimmedLine.match(/^(\d+)\.\s+(.*)/);
          if (ulMatch) {
            pushParagraph();
            pushBlockquote();
            if (currentListType !== 'ul') {
              pushList();
              currentListType = 'ul';
            }
            currentListItems.push({ text: ulMatch[2] });
            isHandled = true;
          } else if (olMatch) {
            pushParagraph();
            pushBlockquote();
            if (currentListType !== 'ol') {
              pushList();
              currentListType = 'ol';
            }
            currentListItems.push({ text: olMatch[2] });
            isHandled = true;
          }
        }

        // 段落
        if (!isHandled) {
          if (currentBlockquoteLines.length > 0) pushBlockquote();
          if (currentListType) pushList();

          if (trimmedLine.length === 0) {
            pushParagraph();
          } else {
            currentParagraphContent.push(trimmedLine);
          }
        }
      });

      pushParagraph();
      pushBlockquote();
      pushList();

      this.setData({ nodes: nodes });
    },

    parseInline: function (text) {
      let nodes = [];
      const regex = /(\*\*(.*?)\*\*)|(\*(.*?)\*)|([^*]+)/g;

      let lastIndex = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          nodes.push({ type: 'text', text: text.substring(lastIndex, match.index) });
        }

        if (match[1]) {
          nodes.push({
            name: 'strong',
            attrs: { class: 'strong' },
            children: [{ type: 'text', text: match[2] }],
          });
        } else if (match[3]) {
          nodes.push({
            name: 'em',
            attrs: { class: 'em' },
            children: [{ type: 'text', text: match[4] }],
          });
        } else if (match[5]) {
          const textParts = match[5].split('\n');
          textParts.forEach((part, index) => {
            if (part.length > 0) {
              nodes.push({ type: 'text', text: part });
            }
            if (index < textParts.length - 1) {
              nodes.push({ name: 'br' });
            }
          });
        }

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < text.length) {
        nodes.push({ type: 'text', text: text.substring(lastIndex) });
      }

      return nodes.filter((node) => !(node.type === 'text' && node.text.trim().length === 0));
    },
  },
});
