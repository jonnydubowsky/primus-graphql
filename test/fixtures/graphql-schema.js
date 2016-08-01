var EventEmitter = require('events').EventEmitter

var debug = require('debug')('primus-graphql:fixtures:graphql-schema')
var GraphQL = require('graphql')
var listenAll = require('listen-all')
var Observable = require('rxjs/Observable').Observable
var Relay = require('graphql-relay')
var RxSubscription = require('rxjs/Subscription').Subscription

var relaySubscription = require('../../graphql-relay-subscription.js')
require('../../src/shared/subscription-dispose.js')

var GraphQLInputObjectType = GraphQL.GraphQLInputObjectType
var GraphQLSchema = GraphQL.GraphQLSchema
var GraphQLString = GraphQL.GraphQLString
var GraphQLNonNull = GraphQL.GraphQLNonNull
var GraphQLObjectType = GraphQL.GraphQLObjectType

// GraphQL types

var UserType = new GraphQLObjectType({
  name: 'User',
  description: 'user',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString }
  }
})

// In memory database

var db = {}
db.users = [
  {
    id: '0',
    name: 'name0'
  }
]
db.ee = new EventEmitter()
listenAll(db.ee, function () {
  debug('db event', arguments)
})

// GraphQL roots

var UpdateMeMutation = Relay.mutationWithClientMutationId({
  name: 'UpdateMe',
  inputFields: {
    name: {
      type: GraphQLString
    }
  },
  outputFields: {
    user: {
      type: UserType
    }
  },
  mutateAndGetPayload (fields, ctx) {
    // hard-coded
    var user = db.users[0]
    user.name = fields.name
    // user.name = fields.name
    debug('emit', 'users:' + user.id)
    db.ee.emit('users:' + user.id, user)
    return {
      user: user,
      clientMutationId: fields.clientMutationId
    }
  }
})

var invalidName = 'InvalidSubscription'
var InvalidSubscription = {
  name: invalidName,
  type: new GraphQLObjectType({
    name: invalidName + 'Output',
    fields: {
      user: {
        type: UserType
      }
    }
  }),
  args: {
    input: {
      type:  new GraphQLInputObjectType({
        name: invalidName + 'Input',
        fields: {
          id: {
            type: new GraphQLNonNull(GraphQLString)
          }
        }
      })
    }
  }
}

var UserChanges = relaySubscription({
  name: 'UserChanges',
  inputFields: {
    id: {
      type: new GraphQLNonNull(GraphQLString)
    }
  },
  outputFields: {
    user: {
      type: UserType // TODO: not actually used yet..
    }
  },
  observe: (input) => {
    var event = 'users:' + input.id
    debug('observe', event, input, input.id)
    return new Observable(function (subscriber) {
      debug('subscribe', event)
      db.ee.on(event, onNext)
      db.ee.on(event + ':error', subscriber.error)
      db.ee.on(event + ':completed', subscriber.complete)
      function onNext (user) {
        subscriber.next({
          userChanges: {
            user: user
          }
        })
      }
      if (input.reconnect) {
        debug('reconnect', event, input, input.id)
        // re-subscribed due to reconnect
        // emit user immediately so that frontend has latest data
        db.ee.emit(event, db.users[input.id])
      }
      return new RxSubscription(function () {
        debug('dispose', event, input.id)
        db.ee.removeListener(event, onNext)
        db.ee.removeListener(event + ':error', subscriber.error)
        db.ee.removeListener(event + ':completed', subscriber.complete)
      })
    })
  }
})

var Mutation = new GraphQLObjectType({
  name: 'Mutation',
  description: 'Root query',
  fields: {
    updateMe: UpdateMeMutation
  }
})

var Query = new GraphQLObjectType({
  name: 'Query',
  description: 'Root query',
  fields: {
    me: {
      type: UserType,
      args: {},
      resolve: () => {
        // hard-coded
        var user = db.users[0]
        user.name = 'name0' // reset name..
        return user
      }
    }
  }
})

var Subscription = new GraphQLObjectType({
  name: 'Subscription',
  description: 'Root subscription',
  fields: {
    userChanges: UserChanges,
    invalidSubscription: InvalidSubscription
  }
})

module.exports = new GraphQLSchema({
  mutation: Mutation,
  query: Query,
  subscription: Subscription
})
