import React from 'react';
import { createRoot } from 'react-dom/client';
import ObjectReconciliationTool from './ObjectReconciliationTool';
import './styles.css';


class ObjectReconciliationToolElement extends HTMLElement {
  constructor() {
    super();
    this.root = null;
  }

  connectedCallback() {
    if (!this.root) {
      this.root = createRoot(this);
      this.root.render(<ObjectReconciliationTool />);
    }
  }

  disconnectedCallback() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}

const elementName = 'object-reconciliation-tool-element';
if (!customElements.get(elementName)) {
  customElements.define(elementName, ObjectReconciliationToolElement);
}
