xingzuo_name=(u'摩羯座',u'水瓶座',u'双鱼座',u'白羊座',u'金牛座',u'双子座',u'巨蟹座',u'狮子座',
u'处女座',u'天秤座',u'天蝎座',u'射手座')
xingzuo_date=((1, 20),(2, 19),(3, 21),(4, 21),(5, 21),(6, 22),(7, 23),(8, 23),(9, 23),(10, 23),(11, 23),(12, 23))
# print(xingzuo_date)
# 用户输入月份和日期
int_month=int(input('请输入月份:'))
int_date=int(input('请输入日期:'))
for xingzuo_num in range(len(xingzuo_date)):
    if xingzuo_date[xingzuo_num]>=(int_month,int_date):
        print(xingzuo_name[xingzuo_num])
        break
    elif int_month==12and int_date>23:
        print(xingzuo_name[0])
        break