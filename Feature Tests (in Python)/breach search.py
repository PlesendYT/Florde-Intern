from sylva.handler import Handler

handler = Handler()
handler.branch_all('username')
results = handler.collector.get_data() 

print(results)