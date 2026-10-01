const now = Math.floor(Date.now() / 1000);
const oneHourAgo = now - 3600;
fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query($greater: Int, $lesser: Int) {
      Page(page: 1, perPage: 50) {
        airingSchedules(airingAt_greater: $greater, airingAt_lesser: $lesser, sort: TIME_DESC) {
          mediaId
          episode
          media {
            title {
              romaji
              english
              native
            }
          }
        }
      }
    }`,
    variables: { greater: oneHourAgo, lesser: now }
  })
}).then(r => r.json()).then(j => console.log(JSON.stringify(j)));
