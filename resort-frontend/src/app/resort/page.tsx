import { ArrowDown, ArrowRight, ArrowUpRight, Check, Compass, Menu, Waves } from "lucide-react";
import { BookingSearch } from "@/components/booking-search";
import { CustomerAccountMenu } from "@/components/customer-account-menu";

const stays = [
  { name: "The Canopy Suite", type: "Jungle-view · 2 guests", price: "₹18,500", image: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1100&q=85", tag: "MOST LOVED" },
  { name: "Poolside Villa", type: "Private plunge pool · 2 guests", price: "₹24,000", image: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1100&q=85", tag: "PRIVATE POOL" },
  { name: "The Garden House", type: "Garden view · 4 guests", price: "₹15,800", image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1100&q=85", tag: "GREAT FOR FAMILIES" },
];

export default function Home() {
  return (
    <main className="resort-site">
      <div className="announcement"><span>AN INVITATION TO SLOW DOWN</span><span>DISCOVER THE MONSOON EDIT <ArrowRight size={13} /></span></div>
      <header className="site-header">
        <a className="wordmark" href="#home">ARANYA<span>WILD, AT YOUR OWN PACE</span></a>
        <nav><a href="#stay">THE STAY</a><a href="#experience">EXPERIENCES</a><a href="#story">OUR STORY</a></nav>
        <a className="header-cta" href="#book">BOOK YOUR STAY <ArrowUpRight size={15}/></a>
        <CustomerAccountMenu />
        <button className="menu-button" aria-label="Open menu"><Menu /></button>
      </header>
      <section className="hero" id="home">
        <div className="hero-image" />
        <div className="hero-shade" />
        <div className="hero-copy"><div className="eyebrow"><span/> A HIDDEN RETREAT IN THE WESTERN GHATS</div><h1>Come back<br/>to <em>yourself.</em></h1><p>Where the forest breathes slower,<br/>and the days find their own rhythm.</p><a href="#stay" className="light-link">FIND YOUR KIND OF QUIET <ArrowRight size={16}/></a></div>
        <div className="hero-bottom"><span>15° 31&apos; N &nbsp; 73° 49&apos; E</span><span>SAHYADRI MOUNTAINS, INDIA</span><a href="#stay"><ArrowDown size={15}/> SCROLL TO EXPLORE</a></div>
        <div className="hero-index">01 <span>/</span> 04</div>
      </section>
      <section className="booking-wrap" id="book"><div className="booking-intro"><span>YOUR ESCAPE,</span><strong>beautifully planned.</strong></div><BookingSearch /></section>
      <section className="intro-section" id="story"><div className="section-kicker">01 &nbsp; / &nbsp; THE ARANYA FEELING</div><div className="intro-content"><h2>A little further<br/>from <em>everything.</em></h2><div><p>Tucked into the folds of the Sahyadris, Aranya is a small collection of considered spaces shaped by the land around them. Come for the stillness. Stay for the way it stays with you.</p><a className="text-link" href="#experience">A NOTE FROM YOUR HOSTS <ArrowUpRight size={15}/></a></div></div></section>
      <section className="stays-section" id="stay"><div className="stays-heading"><div><div className="section-kicker">02 &nbsp; / &nbsp; REST, YOUR WAY</div><h2>Spaces to <em>settle in.</em></h2></div><a className="text-link" href="#book">VIEW ALL STAYS <ArrowRight size={15}/></a></div><div className="stay-grid">{stays.map((stay, i) => <article className="stay-card" key={stay.name}><a className="stay-photo" href="#book" style={{ backgroundImage: `url('${stay.image}')` }}><span className="stay-tag">{stay.tag}</span><span className="stay-number">0{i+1}</span><span className="stay-arrow"><ArrowUpRight size={18}/></span></a><div className="stay-details"><div><h3>{stay.name}</h3><p>{stay.type}</p></div><div className="stay-price">{stay.price}<small> / NIGHT</small></div></div></article>)}</div></section>
      <section className="experience" id="experience"><div className="experience-photo"/><div className="experience-copy"><div className="section-kicker">03 &nbsp; / &nbsp; OUT HERE, TIME OPENS UP</div><h2>Follow the<br/>feeling.</h2><p>Take the long trail. Swim beneath a waterfall. Let the evening unfold around a table set with what the season gives.</p><div className="experience-list"><span><Waves size={16}/> RIVER & FOREST WALKS</span><span><Compass size={16}/> LOCAL TABLE, SLOW FOOD</span><span><Check size={16}/> MOMENTS MADE WITH CARE</span></div><a className="text-link" href="#book">EXPLORE EXPERIENCES <ArrowRight size={15}/></a></div></section>
      <footer><a className="wordmark" href="#home">ARANYA<span>WILD, AT YOUR OWN PACE</span></a><span>MADE FOR THE MOMENTS BETWEEN.</span><a href="#home" aria-label="Instagram" className="social-link">ig</a><span>© 2026 ARANYA RETREATS</span></footer>
    </main>
  );
}
