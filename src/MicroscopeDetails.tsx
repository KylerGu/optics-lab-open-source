import {useState,type ReactNode} from 'react';

type Props={id:string;title:string;className?:string;children:ReactNode};
function RememberedDetails({id,title,className='',children}:Props){
  const storageKey=`optics-microscope-details:v1:${id}`;
  const [open,setOpen]=useState(()=>{try{return localStorage.getItem(storageKey)==='true';}catch{return false;}});
  return <details className={`os-microscope-details ${className}`} open={open} onToggle={event=>{
    const next=event.currentTarget.open;setOpen(next);
    try{localStorage.setItem(storageKey,String(next));}catch{/* Keep the current view usable when storage is unavailable. */}
  }}><summary>{title}</summary>{children}</details>;
}
export default function MicroscopeDetails(props:Props){
  return <RememberedDetails key={props.id} {...props}/>;
}
