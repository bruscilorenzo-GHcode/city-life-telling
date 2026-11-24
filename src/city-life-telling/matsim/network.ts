/** CITY-LIFE-TELLING — coarse seed of Montréal's public-transport networks.
 *
 *  Anchor coordinates are approximate and exist only so the demo simulation
 *  has a credible geography to draw and to match stories against. The
 *  authoritative network (full STM bus system, REM, exo, Laval STL) arrives
 *  with the Polytechnique Montréal MATSim feed and replaces this seed
 *  through the MatsimSource adapter — never by editing the app. */

import type { TransitLine } from './types.js'

function stop(id: string, name: string, lat: number, lon: number) {
  return { id, name, lat, lon }
}

export const MONTREAL_CENTER: [number, number] = [45.512, -73.588]
export const MONTREAL_ZOOM = 11

export const SEED_LINES: TransitLine[] = [
  {
    id: 'metro-green',
    label: 'Métro 1 · Ligne verte',
    mode: 'metro',
    operator: 'STM',
    color: '#2f9e44',
    baseHeadwayMin: 4,
    capacity: 780,
    stops: [
      stop('gr-hb', 'Honoré-Beaugrand', 45.5949, -73.5525),
      stop('gr-sh', 'Sherbrooke', 45.5183, -73.5686),
      stop('gr-bu', 'Berri-UQAM', 45.5152, -73.5613),
      stop('gr-mg', 'McGill', 45.5081, -73.5748),
      stop('gr-gc', 'Guy-Concordia', 45.4972, -73.5780),
      stop('gr-lg', 'Lionel-Groulx', 45.4889, -73.5879),
      stop('gr-vm', 'Vendôme', 45.4792, -73.5994),
      stop('gr-an', 'Angrignon', 45.4466, -73.6034),
    ],
  },
  {
    id: 'metro-orange',
    label: 'Métro 2 · Ligne orange',
    mode: 'metro',
    operator: 'STM',
    color: '#f08c00',
    baseHeadwayMin: 4,
    capacity: 780,
    stops: [
      stop('or-mm', 'Montmorency', 45.6060, -73.7118),
      stop('or-hb', 'Henri-Bourassa', 45.5427, -73.6637),
      stop('or-jt', 'Jean-Talon', 45.5386, -73.6192),
      stop('or-ro', 'Rosemont', 45.5319, -73.5986),
      stop('or-mr', 'Mont-Royal', 45.5228, -73.5867),
      stop('or-bu', 'Berri-UQAM', 45.5152, -73.5613),
      stop('or-sl', 'Saint-Laurent', 45.5147, -73.5647),
      stop('or-psh', 'Place-Saint-Henri', 45.4865, -73.5936),
      stop('or-lg', 'Lionel-Groulx', 45.4889, -73.5879),
      stop('or-ch', 'Charlevoix', 45.4708, -73.5852),
      stop('or-vd', 'Verdun', 45.4608, -73.6022),
      stop('or-ls', 'LaSalle', 45.4487, -73.6040),
    ],
  },
  {
    id: 'metro-yellow',
    label: 'Métro 4 · Ligne jaune',
    mode: 'metro',
    operator: 'STM',
    color: '#fcc419',
    baseHeadwayMin: 6,
    capacity: 420,
    stops: [
      stop('ye-bu', 'Berri-UQAM', 45.5152, -73.5613),
      stop('ye-jd', 'Jean-Drapeau', 45.5120, -73.5330),
      stop('ye-lo', 'Longueuil', 45.5212, -73.5572),
    ],
  },
  {
    id: 'metro-blue',
    label: 'Métro 5 · Ligne bleue',
    mode: 'metro',
    operator: 'STM',
    color: '#4263eb',
    baseHeadwayMin: 7,
    capacity: 420,
    stops: [
      stop('bl-sm', 'Saint-Michel', 45.5588, -73.6018),
      stop('bl-jt', 'Jean-Talon', 45.5386, -73.6192),
      stop('bl-dc', 'De Castelnau', 45.5318, -73.6209),
      stop('bl-pa', 'Parc', 45.5296, -73.6233),
      stop('bl-ac', 'Acadie', 45.5238, -73.6234),
      stop('bl-sn', 'Snowdon', 45.4879, -73.6029),
    ],
  },
  {
    id: 'rem-south',
    label: 'REM · Brossard',
    mode: 'light_rail',
    operator: 'REM',
    color: '#12b886',
    baseHeadwayMin: 8,
    capacity: 560,
    stops: [
      stop('re-gc', 'Gare Centrale', 45.5016, -73.5748),
      stop('re-mg', 'McGill', 45.5081, -73.5748),
      stop('re-is', 'Île-des-Sœurs', 45.4552, -73.5522),
      stop('re-br', 'Brossard', 45.4455, -73.4716),
    ],
  },
  {
    id: 'rem-north',
    label: 'REM · Deux-Montagnes',
    mode: 'light_rail',
    operator: 'REM',
    color: '#20c997',
    baseHeadwayMin: 12,
    capacity: 560,
    stops: [
      stop('rn-gc', 'Gare Centrale', 45.5016, -73.5748),
      stop('rn-mr', 'Mont-Royal', 45.5252, -73.5942),
      stop('rn-bf', 'Bois-Franc', 45.5138, -73.6660),
      stop('rn-dm', 'Deux-Montagnes', 45.5395, -73.9047),
    ],
  },
  {
    id: 'exo-vh',
    label: 'exo · Vaudreuil-Hudson',
    mode: 'regional_rail',
    operator: 'exo',
    color: '#845ef7',
    baseHeadwayMin: 30,
    capacity: 1200,
    stops: [
      stop('ex-lla', 'Lucien-L\'Allier', 45.4486, -73.5776),
      stop('ex-pc', 'Pointe-Claire', 45.4470, -73.7890),
      stop('ex-va', 'Vaudreuil', 45.4000, -74.0280),
    ],
  },
  {
    id: 'bus-80',
    label: 'Bus 80 · Du Parc',
    mode: 'bus',
    operator: 'STM',
    color: '#e66c52',
    baseHeadwayMin: 10,
    capacity: 90,
    stops: [
      stop('b80-dw', 'Avenue du Parc · centre-ville', 45.5069, -73.5780),
      stop('b80-mp', 'Avenue du Parc · Mont-Royal', 45.5236, -73.6018),
      stop('b80-cn', 'Côte-des-Neiges', 45.5310, -73.6200),
    ],
  },
  {
    id: 'bus-139',
    label: 'Bus 139 · Pie-IX',
    mode: 'bus',
    operator: 'STM',
    color: '#d6409f',
    baseHeadwayMin: 12,
    capacity: 90,
    stops: [
      stop('b139-pi', 'Pie-IX · centre-ville', 45.5130, -73.5524),
      stop('b139-mt', 'Pie-IX · Maisonneuve', 45.5540, -73.5490),
      stop('b139-lv', 'Longueuil bord', 45.5850, -73.5470),
    ],
  },
  {
    id: 'bus-121',
    label: 'Bus 121 · Sauvé',
    mode: 'bus',
    operator: 'STM',
    color: '#e8590c',
    baseHeadwayMin: 14,
    capacity: 90,
    stops: [
      stop('b121-cr', 'Sauvé · Crémazie', 45.5440, -73.6390),
      stop('b121-sv', 'Sauvé · L\'Acadie', 45.5420, -73.6600),
      stop('b121-vc', 'Viau Cardinal', 45.5390, -73.6900),
    ],
  },
]

/** Vocabulary used by claim extraction, trilingual. Only coarse anchors are
 *  referenced; the Polytechnique feed will replace the whole dictionary. */
export const LINE_ALIASES: Record<string, string[]> = {
  'metro-green': ['ligne verte', 'green line', 'linea verde', 'métro 1', 'metro 1', 'ligne 1', 'green', 'verde'],
  'metro-orange': ['ligne orange', 'orange line', 'linea arancione', 'métro 2', 'metro 2', 'ligne 2', 'orange', 'arancione'],
  'metro-yellow': ['ligne jaune', 'yellow line', 'linea gialla', 'métro 4', 'metro 4', 'ligne 4', 'yellow', 'gialla'],
  'metro-blue': ['ligne bleue', 'blue line', 'linea blu', 'métro 5', 'metro 5', 'ligne 5', 'blue', 'blu'],
  'rem-south': ['rem brossard', 'rem sud', 'rem south'],
  'rem-north': ['rem deux-montagnes', 'rem deux montagnes', 'rem nord', 'rem north'],
  'exo-vh': ['exo vaudreuil', 'vaudreuil-hudson', 'vaudreuil'],
  'bus-80': ['bus 80', 'ligne 80', 'route 80', 'du parc'],
  'bus-139': ['bus 139', 'ligne 139', 'route 139', 'pie-ix', 'pie ix'],
  'bus-121': ['bus 121', 'ligne 121', 'route 121', 'sauvé', 'sauve'],
}

export const STOP_ALIASES: string[] = Array.from(
  new Set(SEED_LINES.flatMap((line) => line.stops.map((s) => s.name.toLowerCase()))),
)

export function lineById(id: string): TransitLine | undefined {
  return SEED_LINES.find((line) => line.id === id)
}
