/**
 * NotificationController
 * 
 * @description :: Server-side logic for managing Notifications
 * @help :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

const TEMPLATE_ERROR = 'Template not set error';

module.exports = {
	send : function(req, res) {
		var template = req.param('template');
		if (!template) {
			return res.json({
				error : TEMPLATE_ERROR
			});
		}		
		Players.query(
			'SELECT first_name, array_agg(vk_id) AS ids FROM players GROUP BY first_name',			
			function(error, players) {					
				return res.json(NotificationService.send(players.rows, template));					
			}
		);		
	}
};