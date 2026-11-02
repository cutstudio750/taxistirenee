# Avis clients

Le fichier `reviews.json` contient les avis affichés sur le site (section « Avis clients »).
Tant qu'il est vide, le site affiche un message d'attente et un bouton « Laisser un avis ».

N'y mettre que de **vrais avis**, recopiés à l'identique (par exemple depuis la fiche Google), avec l'accord du client :

```json
[
  { "name": "Claire M.", "rating": 5, "text": "Ponctuel et très attentionné, je recommande.", "date": "octobre 2026", "source": "Google" }
]
```
