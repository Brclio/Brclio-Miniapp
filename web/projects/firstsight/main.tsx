import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Aperture } from 'lucide-react';
import { WeddingPage } from './WeddingPage';
import './style.css';

function App() {
  return (
    <div id="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳转至图册</a>
      <header className="app-header">
        <a className="space-link" href="/"><ArrowLeft size={16} /> <span>返回内容空间</span></a>
        <a className="firstsight-brand" href="#/" aria-label="FirstSight 摄影，全部系列"><Aperture size={23} strokeWidth={1.4} /><span>FirstSight <small>摄影</small></span></a>
        <span className="header-signature">BY BRCLIO</span>
      </header>
      <WeddingPage />
      <footer className="app-footer">
        <span>FirstSight <i>摄影</i></span>
        <span>Brclio 口袋 · 婚纱灵感图册</span>
        <a href="mailto:aiyuechuang@gmail.com">联系与反馈</a>
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
