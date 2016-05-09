var request = require('request');
var async = require('async');
var fs = require('fs');
var setCookieParser = require('set-cookie-parser');

const SERVICE_CALL_SUCCESS = 'Success: call notification service';
const SERVICE_CALL_ERROR = 'Error: call notification service';

const TOO_FREQ_ERROR = {
	code: 1,
	description: 'Too frequently'
};

const SERVER_ERROR = {
	code: 2,
	description: 'Server fatal error'
};

const CONNECTION_ERROR = {
	code: 3,
	description: 'Connection error'
};

var cookies = {
	vkontakte: ''	
}; 

var PlayerIterator = function(playersData){
	var self = this;
	const LIMIT = 100;
	
	this.i = 0;
	this.j = 0;		
	this.data = [];
	
	(function(playersData){
		var players = playersData.players; 
		
		if(players){
			for(var i = 0; i <  players.length; i++){
				var player = players[i];
				var parts = player.ids.length / LIMIT;
				self.data[i] = [];
				for(var j = 0; j < parts; j++){
					self.data[i][j] = {};
					var ids = player.ids.slice(j * LIMIT, (j + 1) * LIMIT);
					self.data[i][j]['first_name'] = player.first_name;
					self.data[i][j]['ids'] = ids;  
				}			
			}	
		}else if(playersData.data){
			self.i = playersData.i;
			self.j = playersData.j;
			self.data = playersData.data;
		}
	})(playersData);		
	
	this.next = function(){
		var i = this.i;
		var j = this.j;	
		
		j++;					
		try{
			var player = this.data[i][j];				
			if(!player){
				i++;
				j = 0;			
				player = this.data[i][j];			
			}
			this.i = i;
			this.j = j;
			return player;
		}catch(e){
			return null;
		}
	};
	
	this.set = function(i, j){
		this.i = i;
		this.j = j;
	};
	
	this.get = function(){
		var i = this.i;
		var j = this.j;
		
		try{
			var player = this.data[i][j];
		}catch(e){
			return null;
		}
		return player;		
	};		
	
};

var NotificationService = function(){
	var self = this;
	
	this.generateServerError = function(){
		return SERVER_ERROR; 
	};
	
	this.generateTooFreqError = function(){
		return TOO_FREQ_ERROR;
	};
	
	this.generateConnectionError = function(){
		return CONNECTION_ERROR;
	};
	
	this.throwConnectionError = function(){
		throw SERVER_ERROR; 
	};
	
	this.throwServerError = function(){
		throw SERVER_ERROR; 
	};
	
	this.throwTooFreqError = function(){
		throw TOO_FREQ_ERROR;
	};
	
	this.throwConnectionError = function(){
		throw CONNECTION_ERROR; 
	};
	
	var sendAuthRequest = function(callback){	
		request.post({
			url: sails.config.services.vkontakte + 'sendNotification',		
			json : true				       		
		}, function(error, response, body) {							
			try {													
				if(error){
					self.throwConnectionError();
				}else if(response.statusCode >= 500){				
					self.throwTooFreqError()										
				}						
				
				var setCookie = setCookieParser.parse(response);
				for(var i = 0; i < setCookie.length; i++){
					if(setCookie[i].name == 'vkontakte'){
						cookies.vkontakte = setCookie[i].value; 
						break;
					}
				}								
			}catch(e) {			
				return callback(e, {});
			}
			return callback(null, {});
		});
	};
	
	var sendTimeoutRequest = function(player, template, callback){
		setTimeout(function(){			
			sendRequest(player, template, callback);
		}, 1000);
	};

	var sendRequest = function(players, template, callback){
		var self = NotificationService;				
		var text = template.replace('%name%', players.first_name);
		
		request.post({
			url: sails.config.services.vkontakte + 'sendNotification',
			headers: {
				'Cookie': 'vkontakte=' + cookies.vkontakte 
			},
			formData : {
				ids : players.ids,
				text : text
			},
			json : true				       		
		}, function(error, response, body) {				
			var log = '';
			var logStream = fs.createWriteStream(sails.config.paths.log, {flags : 'a'});		
			try {														
				if(error){
					self.throwConnectionError();
				}else if(response.statusCode == 401){
					self.throwConnectionError();
				}else if(response.statusCode >= 500){
					switch(body.code){
						case 1:
							self.throwTooFreqError();						
						case 2:
							self.throwServerError();
						default:
							self.throwServerError();
					}						
				}											
				
				var setCookie = setCookieParser.parse(response);
				for(var i = 0; i < setCookie.length; i++){
					if(setCookie[i].name == 'vkontakte'){
						cookies.vkontakte = setCookie[i].value; 
						break;
					}
				}
				
				log = 'Success: Send messages to users ' + players.first_name + ' Description: [' + body + '] \n';			
			}catch(e) {
				log = 'Error: Send messages to users ' + players.first_name + ' Description: ' + e.description + ' \n';								
				return callback(e, {});
			}finally {
				logStream.write(log);			
			}
			return callback(null, {});
		});
	};
			
	var restoreNotification = function(){
		fs.readFile(
			sails.config.paths.task,
			'utf8',
			function(err, taskData){
				if(!err){
					taskData = JSON.parse(taskData);
					var playerIterator = new PlayerIterator(taskData.iterator);
					fs.unlink(sails.config.paths.task);														
					async.series([
		              function(callback){
		            	  sendAuthRequest(callback);            	  
		              },
		              function(callback){
		            	  self.sendNotification(playerIterator, taskData.template, callback);            	  
		              }
		            ]);	
				}
			}
		);
	};
	
	this.init = function(){
		var self = this;
		
		fs.exists(
			sails.config.paths.task,
			function(isExist){
				if(isExist){		
					restoreNotification();
				}
			}
		);
	};			
	
	this.sendNotification = function(playerIterator, template, callback){
		var self = this;
		var player = null;
		
		async.whilst(function(){
			if(!player){
				player = playerIterator.get();
			}else{
				player = playerIterator.next();
			}
			if(player){
				return true;
			}
			return false;
		},
		function(callback){
			sendTimeoutRequest(player, template, callback);
		},
		function(err, n){
			if(err){
				if(err.code == 1){					
					return self.sendNotification(playerIterator, template, callback);
				}else if(err.code == 2){					
					return self.saveTask(playerIterator, template);
				}
			}			
		});
	};
	
	this.saveTask = function(playerIterator, template){
		var taskData = {
			iterator: playerIterator,
			template: template 
		};	
		var taskStream = fs.createWriteStream(sails.config.paths.task, {flags : 'w'});
		
		taskData = JSON.stringify(taskData);						
		taskStream.write(taskData);					
	};
	
	this.send = function(players, template){
		var self = this;
		var message = SERVICE_CALL_SUCCESS;
		var playerIterator = new PlayerIterator(
			{
				players: players
			}
		);
		
		try {				
			async.series([
              function(callback){
            	  sendAuthRequest(callback);            	  
              },
              function(callback){
            	  self.sendNotification(playerIterator, template, callback);            	  
              }
            ]);												
		}catch(e){
			message = SERVICE_CALL_ERROR;			
		}
		return {
			message: message
		};
	};
		
};

module.exports = new NotificationService();