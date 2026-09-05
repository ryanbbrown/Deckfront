import { useEffect } from 'react';
import { CARDS } from '../game';
import type { CardDefinition } from '../game';
import { CardFace } from './Game';

const GITHUB_URL = 'https://github.com/ryanbbrown/Deckfront';
const DISCORD_URL = 'https://discord.gg/B4dYUH7vj';

type PublicPageName = 'home' | 'rules' | 'about';

export function PublicSite({ page }: { page: PublicPageName }) {
  useEffect(() => {
    document.title = page === 'home' ? 'Deckfront' : `${page === 'rules' ? 'Rules' : 'About'} · Deckfront`;
  }, [page]);

  if (page === 'home') return <LandingPage />;
  return <ArticlePage page={page} />;
}

function PublicHeader({ current }: { current: PublicPageName }) {
  return <header className="public-header">
    <nav className="public-nav public-nav--learn" aria-label="Learn about Deckfront">
      <a href="/rules" aria-current={current === 'rules' ? 'page' : undefined}>Rules</a>
      <a href="/about" aria-current={current === 'about' ? 'page' : undefined}>About</a>
    </nav>
    <a className="public-logo-link" href="/" aria-current={current === 'home' ? 'page' : undefined} aria-label="Deckfront home">
      <img className="public-logo" src="/Deckfront-dark.png" alt="Deckfront" />
    </a>
    <nav className="public-nav public-nav--community" aria-label="Deckfront links">
      <a className="public-icon-link" href={GITHUB_URL}><GitHubIcon />GitHub</a>
      <a className="public-icon-link" href={DISCORD_URL}><DiscordIcon />Discord</a>
      <a className="public-play-link" href="/play">Play game</a>
    </nav>
  </header>;
}

function LandingPage() {
  return <div className="public-page landing-page">
    <a className="public-skip-link" href="#main">Skip to main content</a>
    <div className="landing-ambient landing-ambient--one" aria-hidden="true" />
    <div className="landing-ambient landing-ambient--two" aria-hidden="true" />
    <PublicHeader current="home" />
    <main className="landing-main" id="main">
      <div className="landing-stage">
        <CardPair side="left" cards={[CARDS.rally!, CARDS.sharpen!]} />
        <section className="landing-hero" aria-labelledby="landing-title">
          <h1 id="landing-title"><span>Build your</span><span>battle plan.</span><span className="landing-title-gold">Fight.</span></h1>
          <p className="landing-lede">Deckfront combines Dominion-style static market deckbuilding with tactical combat. Build the right deck, play combos, and take the other fighter to 0 health.</p>
          <div className="landing-actions">
            <a className="landing-button landing-button--primary" href="/play">Play Deckfront <span aria-hidden="true">→</span></a>
            <a className="landing-button landing-button--secondary" href="/rules">Read the rules</a>
          </div>
          <p className="landing-proof">Solo against AI or two players on one computer · Free and open source</p>
        </section>
        <CardPair side="right" cards={[CARDS.starfire!, CARDS.longshot!]} />
      </div>
    </main>
  </div>;
}

function CardPair({ side, cards }: { side: 'left' | 'right'; cards: [CardDefinition, CardDefinition] }) {
  return <div className={`landing-cards landing-cards--${side}`} aria-hidden="true">
    {cards.map((card) => <article className={`card full-card landing-card card--${card.family}`} data-landing-card={card.name} key={card.id}><CardFace card={card} /></article>)}
  </div>;
}

function ArticlePage({ page }: { page: 'rules' | 'about' }) {
  return <div className="public-page article-page">
    <a className="public-skip-link" href="#main">Skip to main content</a>
    <PublicHeader current={page} />
    <main className="article-main" id="main">
      {page === 'rules' ? <RulesContent /> : <AboutContent />}
    </main>
    <footer className="public-footer">
      <p>Build your battle plan. Fight.</p>
      <a href="/play">Play Deckfront <span aria-hidden="true">→</span></a>
    </footer>
  </div>;
}

function RulesContent() {
  return <article className="public-article">
    <header className="article-intro"><span>How to play</span><h1>Rules</h1><p>Build your deck, control the distance, and take the other fighter to 0 health.</p></header>
    <section><h2>Objective</h2><p>The first player starts with 47 health. The second player starts with 50 health. You win when the other fighter reaches 0 health.</p></section>
    <section><h2>Your turn</h2><ol><li><strong>Action phase.</strong> Play as many Action cards as you want and can legally use.</li><li><strong>Buy phase.</strong> End the Action phase to play your Treasures. Buy as many cards as your money allows.</li></ol><p>At the end of your turn, discard your hand and played cards, then draw a new hand of five cards.</p></section>
    <section><h2>Build your deck</h2><p>Bought cards go into your discard pile. They do not enter your current hand. When your draw pile runs out, shuffle your discard pile to make a new draw pile. Each purchase changes the hands you can draw later.</p></section>
    <section><h2>Shared market</h2><p>Both players buy from the same 16 market piles. Copper, Silver, Gold, Step, Focus, and Scrap are always available. A numbered battlefield identifies the 10 changing market piles used with the six-space arena.</p></section>
    <section><h2>Battlefield and range</h2><p>The fighters move across a battlefield with six spaces. The distance between them creates three ranges:</p><ul><li><strong>Close:</strong> both fighters are on the same space.</li><li><strong>Near:</strong> the fighters are one space apart.</li><li><strong>Far:</strong> the fighters are two or more spaces apart.</li></ul></section>
    <section><h2>Attacks</h2><p>Any card that can deal damage is an attack, including Engine cards such as Scrap. An attack still counts when it deals 0 damage.</p><div className="rule-family-grid"><article className="rule-family rule-family--melee"><h3>Melee (red cards)</h3><p>Melee attacks work at Close range.</p></article><article className="rule-family rule-family--ranged"><h3>Ranged (green cards)</h3><p>Ranged attacks work at Near or Far range.</p></article><article className="rule-family rule-family--mana"><h3>Mage (blue cards)</h3><p>Mage attacks work at any range, but you must build and spend mana. You can carry up to 2 unspent mana between turns.</p></article></div></section>
    <section><h2>Starting deck</h2><p>A standard deck starts with 7 Copper and 3 Scrap. Scrap costs 1 and has a 10-card market pile, but card effects cannot gain it.</p></section>
    <section><h2>Choose a match</h2><p>Play against an AI opponent or play a local match with two people sharing one computer. AI matches offer four difficulty levels and let you choose whether you or the AI moves first.</p><h3>Optional local starting draft</h3><p>Local matches can use a starting draft. Before the first turn, each player spends up to 12 money on cards from the current market. Shuffle those cards with 7 Copper to form the opening deck. Up to 3 unspent draft money carries into the first Buy phase.</p></section>
  </article>;
}

function AboutContent() {
  return <article className="public-article">
    <header className="article-intro"><span>About the game</span><h1>Deck-building meets tactical combat</h1><p>Deckfront is a two-player combat game. Build a stronger deck while the fight unfolds across a six-space battlefield.</p></header>
    <section><h2>The core idea</h2><p>Deckfront starts each player with a weak deck. Bought cards enter the deck after a later shuffle. The distance between the fighters decides which attacks can connect, so your purchase plan and your position must work together.</p><p>Dominion is the main influence on the market. Ten variable cards define each match, while six fixed cards are always available. Cards draw more cards, remove weak cards, move fighters, and attack at different ranges.</p></section>
    <section><h2>Initial public playtest</h2><p>You can play against an AI opponent or share one computer for a local match. The playtest has four AI difficulty levels, sitewide aggregate results for each difficulty, 46 card types, 160 numbered battlefields, optional local starting drafts, persistent saves, and multi-step undo.</p></section>
    <section><h2>AI and balance</h2><p>Each AI strategy uses an ordered purchase plan that people can read, plus a shared policy for card play and movement. The work values strategies that are clear, repeatable, and useful across many battlefields rather than an opaque opponent that is hard to explain.</p><p>Repeated simulated matches help compare strategies and card use across the 160 numbered battlefields. This work aims to keep Melee, Ranged, and Mana plans competitive and to give every card a useful place.</p></section>
    <section><h2>What is coming</h2><ul><li>Online multiplayer.</li><li>Player accounts and profiles.</li><li>New battlefields outside the selected 160, with matching AI opponents.</li><li>Mobile layouts.</li></ul></section>
  </article>;
}

function GitHubIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C16.7 4.7 17.7 5 17.7 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6A11.5 11.5 0 0 0 12 .7Z" /></svg>;
}

function DiscordIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.5 5.3A16.3 16.3 0 0 0 15.4 4l-.5 1.1a15 15 0 0 0-5.8 0L8.6 4a16.7 16.7 0 0 0-4.1 1.3C1.9 9.2 1.2 13 1.6 16.8a16.8 16.8 0 0 0 5.1 2.6L8 17.7l-.1-.1a10.7 10.7 0 0 1-1.6-.8l.4-.3a11.7 11.7 0 0 0 10.6 0l.4.3a12 12 0 0 1-1.6.8l-.1.1 1.3 1.7a16.8 16.8 0 0 0 5.1-2.6c.5-4.4-.8-8.2-2.9-11.5ZM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2c1 0 1.8.9 1.8 2s-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" /></svg>;
}
