const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const intializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log(`Server Running at http://localhost:3000/`)
    })
  } catch (error) {
    console.log(`DB Error: ${error.message}`)
    process.exit(1)
  }
}

intializeDBAndServer()

function authenticateToken(request, response, next) {
  let jwtToken
  const authHeader = request.headers['authorization']

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        next()
      }
    })
  }
}

const follows = async (request, response, next) => {
  const {tweetId} = request.params
  let isFollowing = `
  SELECT * 
  FROM follower 
  WHERE 
    follower_user_id = (select user_id from user WHERE username = '${request.username}')
    AND 
    following_user_id = (select user.user_id from tweet NATURAL JOIN user WHERE tweet_id = ${tweetId})`

  if (isFollowing === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

// POST API 1

const validatePassword = password => {
  return password.length > 5
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)

  const selectUserQuery = `
  SELECT * 
  FROM user 
  WHERE 
    username = '${username}'`

  const user = await db.get(selectUserQuery)

  if (user === undefined) {
    const createUserQuery = `
    INSERT INTO 
      user (name, username, password, gender)
    VALUES
      ('${username}', '${hashedPassword}', '${name}', '${gender}')`

    await db.run(createUserQuery)

    if (validatePassword(password)) {
      await db.run(createUserQuery)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exits')
  }
})

// POST API 2 login

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const createUserQuery = `
  SELECT * 
  FROM user
  WHERE 
    username = '${username}'`

  const user = await db.get(createUserQuery)

  if (user === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password)

    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// GET API 3

const dbResponse = dbObject => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
})

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const tweetsQuery = `
  SELECT 
    tweet.tweet_id,
    tweet.tweet,
    tweet.user_id,
    tweet.date_time,
    user.username
  FROM tweet
  LEFT JOIN follower 
    ON tweet.user_id = follower.following_user_id
  LEFT JOIN user
    ON follower.following_user_id = user.user_id
  WHERE 
    follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
  ORDER BY 
    tweet.date_time DESC
  LIMIT 4`

  const latestTweets = await db.all(tweetsQuery)
  response.send(latestTweets.map(each => dbResponse(each)))
})

// GET API 4

app.get('/user/following/', authenticateToken, async (request, response) => {
  const followingQuery = `
  SELECT 
    user.name
  FROM follower
    LEFT JOIN user
  ON follower.following_user_id = user.user_id
  WHERE 
    follower.follower_user_id = (select user_id from user WHERE username = '${request.username}')`

  const userNames = await db.all(followingQuery)
  response.send(userNames)
})

// GET API 5

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const followerQuery = `
  SELECT 
    user.name
  FROM follower
    LEFT JOIN user
  ON follower.follower_user_id = user.user_id
  WHERE 
    follower_user_id = (select user_id from user WHERE username = '${request.username}')`

  const followerNames = await db.all(followerQuery)
  response.send(followerNames)
})

// GET API 6

app.get(
  '/tweets/:tweetId/',
  authenticateToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const {tweet, date_time} = await db.get(`
  SELECT tweet, date_time FROM tweet WHERE tweet_id = ${tweetId}`)

    const {likes} = await db.get(
      `select count(like_id) as likes from like where tweet_id = ${tweetId}`,
    )

    const {replies} = await db.get(
      `select count(reply_id) as replies from reply where tweet_id = ${tweetId}`,
    )

    response.send({tweet, likes, replies, dateTime: date_time})
  },
)

// GET API 7

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const likeQuery = `
  select user.username from 
  like NATURAL JOIN user 
  where tweet_id = ${tweetId}`

    const likeBy = await db.all(likeQuery)
    response.send({likes: likeBy.map(item => item.username)})
  },
)

// GET API 8

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  follows,
  async (request, response) => {
    const {tweetId} = request.params
    const repliesQuery = `
  select user.name, reply.reply from 
  reply NATURAL JOIN user 
  where tweet_id = ${tweetId}`

    const replies = await db.all(repliesQuery)
    response.send({replies})
  },
)

// GET API 9

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const myTweetsQuery = `
  select tweet.tweet,
  count(distinct like.like_id) as likes,
  count(distinct reply.reply_id) as replies,
  tweet.date_time 
  from tweet
  LEFT JOIN like on tweet.tweet_id = like.tweet_id
  LEFT JOIN reply on tweet.tweet_id = reply.tweet_id
  WHERE tweet.user_id = (select user_id from user where username = '${request.username}')
  GROUP BY tweet.tweet_id`

  const myTweets = await db.all(myTweetsQuery)
  response.send(
    myTweets.map(item => {
      const {date_time, ...rest} = item
      return {...rest, dateTime: date_time}
    }),
  )
})

// POST API 10

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const createQuery = await db.get(`
  select user_id from user where username = '${request.username}'`)

  await db.run(`
  INSERT INTO 
    tweet (tweet) 
  VALUES ('${tweet}')`)

  response.send('Created a Tweet')
})

// DELETE API 11

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    
      const deleteTweetQuery = `
      DELETE FROM tweet WHERE tweet_id = '${tweetId}'`

      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    },
)


module.exports = app 

