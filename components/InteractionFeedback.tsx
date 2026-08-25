'use client';
import {useEffect,useState} from 'react';
import './InteractionFeedback.css';

const LOCK_MS=900;

export default function InteractionFeedback(){
  const[active,setActive]=useState(false);
  useEffect(()=>{
    let barTimer:ReturnType<typeof setTimeout>|undefined;
    const locked=new WeakSet<HTMLButtonElement>();
    function begin(button:HTMLButtonElement){
      if(locked.has(button))return false;
      locked.add(button);
      button.classList.add('action-pending');
      button.setAttribute('aria-busy','true');
      setActive(true);
      if(barTimer)clearTimeout(barTimer);
      window.setTimeout(()=>{locked.delete(button);button.classList.remove('action-pending');button.removeAttribute('aria-busy')},LOCK_MS);
      barTimer=window.setTimeout(()=>setActive(false),LOCK_MS);
      return true;
    }
    function click(event:MouseEvent){
      const button=(event.target as Element|null)?.closest('button');
      if(!button||button.disabled)return;
      if(!begin(button)){event.preventDefault();event.stopImmediatePropagation()}
    }
    document.addEventListener('click',click,true);
    return()=>{document.removeEventListener('click',click,true);if(barTimer)clearTimeout(barTimer)};
  },[]);
  return <div className={`global-action-progress ${active?'active':''}`} role="progressbar" aria-hidden={!active}><i/></div>
}
