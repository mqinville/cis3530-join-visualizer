export interface Preset {
  id: string;
  title: string;
  slide: string;
  /** The question as it is asked on the slide. */
  question: string;
  query: string;
  /** Slides 9–40 use 4 artists; slides 44+ add Bachchan (aID 5). */
  bachchan: boolean;
}

// Every query below comes from the CIS3530 Week 2 slides.
export const PRESETS: Preset[] = [
  {
    id: 'natural-basic', title: 'Natural join R1 ⋈ R2', slide: 'Slides 22 & 47',
    question: 'Join R1 and R2 on their common attribute col1.',
    query: 'R1 ⋈ R2', bachchan: false,
  },
  {
    id: 'left-basic', title: 'Left outer join R1 ⟕ R2', slide: 'Slide 47',
    question: 'Keep every R1 row, padding with null when there is no match.',
    query: 'R1 ⟕ R2', bachchan: false,
  },
  {
    id: 'right-basic', title: 'Right outer join R1 ⟖ R2', slide: 'Slide 47',
    question: 'Keep every R2 row, padding with null when there is no match.',
    query: 'R1 ⟖ R2', bachchan: false,
  },
  {
    id: 'full-basic', title: 'Full outer join R1 ⟗ R2', slide: 'Slide 47',
    question: 'Keep every row from both sides, padding with null.',
    query: 'R1 ⟗ R2', bachchan: false,
  },
  {
    id: 'q1-product', title: 'Q1: Artists × Roles', slide: 'Slide 33',
    question: 'How many tuples are in Artists × Roles?',
    query: 'Artists × Roles', bachchan: false,
  },
  {
    id: 'q2-natural', title: 'Q2: Artists ⋈ Roles', slide: 'Slide 33',
    question: 'How many tuples are in Artists ⋈ Roles?',
    query: 'Artists ⋈ Roles', bachchan: false,
  },
  {
    id: 'q3-kubrick', title: 'Q3: Kubrick actors (join first)', slide: 'Slide 33',
    question: 'What is the result of πaName(σdirector="Kubrick"(Artists ⋈ Roles ⋈ Movies))?',
    query: "π[aName](σ[director = 'Kubrick'](Artists ⋈ Roles ⋈ Movies))", bachchan: false,
  },
  {
    id: 'q4-kubrick', title: 'Q4: Kubrick actors (select first)', slide: 'Slide 33',
    question: 'What is the result of πaName((σdirector="Kubrick" Movies) ⋈ Roles ⋈ Artists)?',
    query: "π[aName]((σ[director = 'Kubrick'](Movies)) ⋈ Roles ⋈ Artists)", bachchan: false,
  },
  {
    id: 'british', title: 'Names of British actors', slide: 'Slides 11–13',
    question: 'What if we only want the names of all British actors?',
    query: "π[aName](σ[nationality = 'British'](Artists))", bachchan: false,
  },
  {
    id: '70s-product', title: '1970s characters using × and σ', slide: 'Slides 14–21',
    question: 'Names of all characters in movies from the 1970s (Cartesian product, then select).',
    query: 'π[character](σ[Movies.mID = Roles.mID ∧ year >= 1970 ∧ year <= 1979](Movies × Roles))', bachchan: false,
  },
  {
    id: '70s-natural', title: '1970s characters using ⋈', slide: 'Slides 22–23',
    question: 'The same query, written with a natural join instead.',
    query: 'π[character](σ[year >= 1970 ∧ year <= 1979](Movies ⋈ Roles))', bachchan: false,
  },
  {
    id: 'theta', title: 'Theta (equi) join', slide: 'Slide 41',
    question: 'R ⋈condition S = σcondition(R × S). Join Movies and Roles on mID.',
    query: 'Movies ⋈[Movies.mID = Roles.mID] Roles', bachchan: false,
  },
  {
    id: 'dangling', title: 'Dangling tuples: artists ⋈ roles', slide: 'Slides 43–44',
    question: 'List all artists and the roles they play (Artists now includes Bachchan).',
    query: 'Artists ⋈ Roles', bachchan: true,
  },
  {
    id: 'outer-artists', title: 'Artists ⟕ Roles', slide: 'Slides 45 & 48',
    question: 'List all artists and the roles they play, if they play any.',
    query: 'Artists ⟕ Roles', bachchan: true,
  },
  {
    id: 'self-join', title: 'Pairs of artists with the same nationality', slide: 'Slides 57–58',
    question: 'Find pairs of names of all artists with the same nationality (self-join with ρ and ×).',
    query: 'π[A1.aName, A2.aName](σ[A1.nationality = A2.nationality ∧ A1.aID < A2.aID](ρ[A1](Artists) × ρ[A2](Artists)))', bachchan: false,
  },
];
